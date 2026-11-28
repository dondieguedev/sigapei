<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\common\Services\AuditService;
use App\pieces_justificatives\PieceJustificative;
use App\pieces_justificatives\PieceUploadService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CandidatureService
{
    /** Champs que le candidat peut renseigner. Tout le reste est ignoré. */
    private const CHAMPS_CANDIDAT = [
        'nom', 'prenom', 'date_naissance', 'sexe', 'email', 'telephone', 'adresse',
        'niveau_precedent', 'etablissement_precedent',
        'parent_nom', 'parent_prenom', 'parent_telephone', 'parent_email', 'parent_lien',
    ];

    public function __construct(
        protected CandidatureRepository $repository,
        protected ValidationService $validationService,
        protected PieceUploadService $pieces,
    ) {}

    public function listerCandidatures(array $filtres = []): Collection
    {
        return $this->repository->lister($filtres);
    }

    /**
     * Soumission d'une candidature (route publique ou personnel).
     * Un dossier qui ne respecte pas les exigences de l'appel n'est JAMAIS enregistré.
     *
     * @param  array<string,mixed>                              $donnees
     * @param  array<string,\Illuminate\Http\UploadedFile>      $fichiers indexés par identifiant de pièce (p0, p1…)
     * @throws CandidatureException
     */
    public function soumettreCandidature(array $donnees, array $fichiers = []): Candidature
    {
        if (empty($donnees['appel_uuid'])) {
            throw new CandidatureException("L'appel à candidature est obligatoire.", 'APPEL_REQUIS', 422);
        }

        $appel = AppelCandidature::where('uuid', $donnees['appel_uuid'])->first();
        $this->exigerAppelOuvert($appel);

        $erreurs = CriteresEvaluateur::valider($appel, $donnees, $fichiers);
        if ($erreurs) {
            throw new CandidatureException(
                'Votre dossier ne remplit pas les conditions de cet appel à candidature.',
                'CRITERES_NON_REMPLIS', 422, $erreurs
            );
        }

        $propre = array_intersect_key($donnees, array_flip(self::CHAMPS_CANDIDAT));
        $propre = array_map(fn($v) => is_string($v) ? trim($v) : $v, $propre);
        $propre = array_filter($propre, fn($v) => $v !== null && $v !== '');

        $stockes = [];
        try {
            return DB::transaction(function () use ($appel, $donnees, $propre, $fichiers, &$stockes) {
                // Verrou sur l'appel : fenêtre, places et statut sont relus sous verrou (pas de course sur la dernière place).
                $verrou = AppelCandidature::where('id', $appel->id)->lockForUpdate()->first();
                $this->exigerAppelOuvert($verrou);
                if ($verrou->places_disponibles !== null && $verrou->places_disponibles <= 0) {
                    throw new CandidatureException('Toutes les places disponibles pour cet appel ont été pourvues.', 'PLACES_EPUISEES', 409);
                }

                $paiement = CriteresEvaluateur::paiementRequis($verrou);
                $propre['appel_uuid'] = $verrou->uuid;
                $propre['classe_visee_id'] = $verrou->classe_visee_id;     // fixé par l'appel, jamais par le client
                $propre['etablissement_uuid'] = app()->bound('current_tenant_ref') ? app('current_tenant_ref') : null;
                $propre['empreinte_doublon'] = $this->empreinteDoublon($verrou->uuid, $propre);
                $propre['statut'] = $paiement ? 'en_attente_paiement' : 'soumise';
                $propre['date_soumission'] = now();
                $propre['donnees_complementaires'] = $this->complements($verrou, $donnees);
                foreach (CriteresEvaluateur::criteres($verrou) as $c) {
                    if ($c['type'] === 'type_inscription' && $c['mode'] !== '') {
                        $propre['type_inscription'] = $c['mode'];      // modalité imposée par l'appel
                    }
                }
                if ($paiement) {
                    $propre['statut_paiement'] = 'en_attente';
                    $propre['montant_du'] = $verrou->montant;           // montant de l'appel, jamais celui du client
                    $propre['devise_paiement'] = CriteresEvaluateur::devise($verrou);
                    $propre['paiement_expire_le'] = now()->addMinutes((int) config('inscription.paiement_expiration_minutes', 30));
                }

                $candidature = $this->creerAvecReference($propre);

                if ($verrou->places_disponibles !== null) {
                    $verrou->decrement('places_disponibles');
                }

                foreach (CriteresEvaluateur::pieces($verrou) as $p) {
                    $f = $fichiers[$p['id']] ?? null;
                    if (!$f) {
                        continue;
                    }
                    $s = $this->pieces->stocker($f, $candidature->tenant_id, $candidature->uuid);
                    $stockes[] = $s['chemin'];
                    PieceJustificative::create([
                        'candidature_id' => $candidature->id,
                        'type' => 'autre',
                        'piece_id' => $p['id'],
                        'libelle' => $p['libelle'],
                        'nom_original' => $s['nom_original'],
                        'chemin_stockage' => $s['chemin'],
                        'taille_octets' => $s['taille'],
                        'mime_type' => $s['mime'],
                        'hash_sha256' => $s['hash'],
                        'statut_validation' => 'en_attente',
                    ]);
                }

                AuditService::journaliser(
                    'SOUMISSION_CANDIDATURE',
                    "Nouvelle candidature {$candidature->reference}",
                    ['uuid' => $candidature->uuid, 'appel_uuid' => $verrou->uuid, 'paiement_requis' => $paiement]
                );

                return $candidature;
            });
        } catch (UniqueConstraintViolationException) {
            $this->nettoyer($stockes);
            throw new CandidatureException('Un dossier identique a déjà été déposé pour cet appel.', 'DOUBLON', 409);
        } catch (\Throwable $e) {
            $this->nettoyer($stockes);
            throw $e;
        }
    }

    public function consulterDetail(string $uuid): array
    {
        $c = $this->repository->trouverParUuid($uuid);
        if (!$c) {
            throw new CandidatureException('Candidature introuvable.', 'CANDIDATURE_INTROUVABLE', 404);
        }

        return [
            'uuid' => $c->uuid, 'reference' => $c->reference,
            'nom' => $c->nom, 'prenom' => $c->prenom,
            'date_naissance' => $c->date_naissance?->format('Y-m-d'), 'sexe' => $c->sexe,
            'email' => $c->email, 'telephone' => $c->telephone, 'adresse' => $c->adresse,
            'statut' => $c->statut, 'statut_paiement' => $c->statut_paiement,
            'montant_du' => $c->montant_du, 'devise_paiement' => $c->devise_paiement,
            'appel_uuid' => $c->appel_uuid,
            'type_inscription' => $c->type_inscription, 'niveau_precedent' => $c->niveau_precedent,
            'etablissement_precedent' => $c->etablissement_precedent,
            'donnees_complementaires' => $c->donnees_complementaires,
            'date_soumission' => $c->date_soumission?->toIso8601String(),
            'date_traitement' => $c->date_traitement?->toIso8601String(),
            'motif_rejet' => $c->motif_rejet,
            'parent' => [
                'nom' => $c->parent_nom, 'prenom' => $c->parent_prenom, 'telephone' => $c->parent_telephone,
                'email' => $c->parent_email, 'lien' => $c->parent_lien,
            ],
            // Le chemin de stockage n'est jamais exposé : l'accès passe par l'URL signée (audit + contrôle du tenant).
            'pieces_justificatives' => $c->piecesJustificatives->map(fn($p) => [
                'uuid' => $p->uuid, 'libelle' => $p->libelle, 'type' => $p->type, 'nom_original' => $p->nom_original,
                'mime_type' => $p->mime_type, 'taille_octets' => $p->taille_octets, 'statut_validation' => $p->statut_validation,
            ]),
            'tests_admission' => $c->testsAdmission->map(fn($t) => [
                'uuid' => $t->uuid, 'type_test' => $t->type_test, 'matiere' => $t->matiere,
                'note' => $t->note, 'note_max' => $t->note_max, 'resultat' => $t->resultat,
            ]),
        ];
    }

    public function valider(string $uuid): array
    {
        return $this->validationService->validerCandidature($uuid);
    }

    public function rejeter(string $uuid, string $motif): array
    {
        return $this->validationService->rejeterCandidature($uuid, $motif);
    }

    // ───────────────────────────── internes ─────────────────────────────

    private function exigerAppelOuvert(?AppelCandidature $appel): void
    {
        if (!$appel) {
            throw new CandidatureException("L'appel à candidature est introuvable.", 'APPEL_INTROUVABLE', 404);
        }
        if ($appel->accepteCandidatures()) {
            return;
        }
        $now = now();
        if (in_array($appel->statut, ['termine', 'annule', 'ferme'], true) || ($appel->date_fin && $now->gt($appel->date_fin))) {
            throw new CandidatureException('Cet appel à candidature est clôturé. Les candidatures ne sont plus acceptées.', 'APPEL_CLOTURE', 409);
        }
        if ($appel->date_debut && $now->lt($appel->date_debut)) {
            throw new CandidatureException(
                "Cet appel n'est pas encore ouvert. Ouverture le " . $appel->date_debut->locale('fr')->translatedFormat('d F Y à H:i') . '.',
                'APPEL_NON_OUVERT', 409
            );
        }
        throw new CandidatureException("Cet appel à candidature n'est pas ouvert aux candidatures.", 'APPEL_NON_OUVERT', 409);
    }

    /** Réponses aux critères libres (attestations), bornées aux critères réellement définis par l'appel. */
    private function complements(AppelCandidature $appel, array $donnees): ?array
    {
        $att = [];
        foreach (CriteresEvaluateur::criteres($appel) as $c) {
            if ($c['type'] === 'texte') {
                $att[$c['id']] = [
                    'condition' => $c['texte'],
                    'atteste' => filter_var($donnees['attestations'][$c['id']] ?? false, FILTER_VALIDATE_BOOLEAN),
                ];
            }
        }

        return $att ? ['attestations' => $att] : null;
    }

    private function empreinteDoublon(string $appelUuid, array $d): string
    {
        $n = fn($v) => preg_replace('/[^a-z0-9]/', '', strtolower(Str::ascii((string) $v)));

        return hash('sha256', $appelUuid . '|' . $n($d['nom'] ?? '') . '|' . $n($d['prenom'] ?? '') . '|' . substr((string) ($d['date_naissance'] ?? ''), 0, 10));
    }

    private function creerAvecReference(array $donnees): Candidature
    {
        for ($i = 0; $i < 5; $i++) {
            $donnees['reference'] = $this->genererReference();
            try {
                // Savepoint : une collision de référence ne doit pas invalider la transaction englobante.
                return DB::transaction(fn() => $this->repository->creer($donnees));
            } catch (UniqueConstraintViolationException $e) {
                if (!str_contains($e->getMessage(), 'reference')) {
                    throw $e;
                }
            }
        }
        throw new \RuntimeException('Génération du numéro de suivi impossible.');
    }

    /** Numéro de suivi non devinable (~80 bits), alphabet sans caractères ambigus : SGP-XXXX-XXXX-XXXX-XXXX. */
    private function genererReference(): string
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $bloc = '';
        for ($i = 0; $i < 16; $i++) {
            $bloc .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return 'SGP-' . implode('-', str_split($bloc, 4));
    }

    private function nettoyer(array $chemins): void
    {
        foreach ($chemins as $c) {
            $this->pieces->supprimer($c);
        }
    }
}
