<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\common\Services\AuditService;
use App\common\Services\TenantResolver;
use App\integrations\EtablissementsClient;
use App\integrations\IdentiteClient;
use App\integrations\ScolariteClient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Décisions sur les dossiers. Machine d'états stricte :
 *
 *     soumise | en_attente ──valider──▶ validee   (définitif)
 *     soumise | en_attente ──rejeter──▶ rejetee   (définitif)
 *
 * Une décision est prise sous verrou de ligne : deux administrateurs (ou deux clics) ne peuvent pas
 * produire un dossier à la fois validé et rejeté. Aucune sortie de « validee » ni de « rejetee ».
 */
class ValidationService
{
    private const TRAITABLES = ['soumise', 'en_attente'];

    public function __construct(
        protected CandidatureRepository $repository,
        protected ScolariteClient $scolariteClient,
        protected EtablissementsClient $etablissementsClient,
        protected IdentiteClient $identiteClient
    ) {}

    public function validerCandidature(string $candidatureUuid, ?string $lotUuid = null, bool $verifierModule = true): array
    {
        $tenantId = $this->tenant();
        if ($verifierModule) {
            $this->exigerModuleActif($tenantId);
        }

        return DB::transaction(function () use ($candidatureUuid, $lotUuid, $tenantId) {
            $c = $this->verrouiller($candidatureUuid);
            $this->exigerTraitable($c, 'valider');

            $appel = $c->appel_uuid ? AppelCandidature::where('uuid', $c->appel_uuid)->first() : null;
            $classeRef = $appel?->classe_uuid ?: ($appel?->classe_visee_id ?: $c->classe_visee_id);
            if (empty($classeRef)) {
                throw new CandidatureException("Validation impossible : aucune classe visée n'est définie pour ce dossier.", 'CLASSE_INCONNUE', 422);
            }

            try {
                $dispo = $this->scolariteClient->verifierDisponibilite($classeRef, $tenantId);
            } catch (\Throwable $e) {
                throw new CandidatureException('Vérification de la classe impossible : ' . $e->getMessage(), 'CLASSE_INDISPONIBLE', 502);
            }
            if ($dispo['est_complete']) {
                throw new CandidatureException("La classe « {$dispo['nom']} » a atteint sa capacité maximale ({$dispo['capacite']} places).", 'CLASSE_COMPLETE', 409);
            }

            $parent = $this->identiteClient->trouverUtilisateurParContact($c->parent_email, $c->parent_telephone);
            $parentUuid = $parent->uuid ?? null;

            // Scolarité est idempotent sur candidature_uuid : en cas de reprise après échec, aucun doublon.
            try {
                $apprenant = $this->scolariteClient->creerApprenant([
                    'classe_uuid'          => $dispo['uuid'],
                    'candidature_uuid'     => $c->uuid,
                    'parent_identite_uuid' => $parentUuid,
                    'nom'                  => $c->nom,
                    'prenom'               => $c->prenom,
                    'date_naissance'       => $c->date_naissance?->format('Y-m-d'),
                    'sexe'                 => $c->sexe,
                    'parent_lien'          => $c->parent_lien,
                ]);
            } catch (CandidatureException $e) {
                throw $e;
            } catch (\Throwable $e) {
                throw new CandidatureException("La création de l'apprenant a échoué : " . $e->getMessage(), 'CREATION_APPRENANT_ECHEC', 502);
            }

            $c->forceFill(array_merge(['statut' => 'validee'], $this->traitement($lotUuid)))->save();

            AuditService::journaliser('VALIDATION_CANDIDATURE',
                "Candidature {$c->reference} validée pour la classe {$dispo['nom']}",
                [
                    'candidature_uuid' => $c->uuid, 'lot_uuid' => $lotUuid,
                    'apprenant_uuid' => $apprenant['uuid'] ?? null, 'classe_nom' => $dispo['nom'],
                    'programme' => $dispo['programme'] ?? null, 'parent_lie' => $parentUuid !== null,
                ]);

            return [
                'candidature_uuid' => $c->uuid,
                'statut'           => 'validee',
                'apprenant'        => [
                    'uuid' => $apprenant['uuid'] ?? null, 'classe' => $dispo['nom'], 'programme' => $dispo['programme'] ?? null,
                    'parent_lie' => $parentUuid !== null, 'compte_utilisateur_cree' => $apprenant['compte_utilisateur_cree'] ?? false,
                ],
                'message' => 'Candidature validée avec succès et apprenant généré dans la scolarité.',
            ];
        });
    }

    public function rejeterCandidature(string $candidatureUuid, string $motif, ?string $lotUuid = null): array
    {
        $motif = trim($motif);
        if (mb_strlen($motif) < 5 || mb_strlen($motif) > 500) {
            throw new CandidatureException('Le motif du rejet est obligatoire (5 à 500 caractères).', 'MOTIF_INVALIDE', 422);
        }

        return DB::transaction(function () use ($candidatureUuid, $motif, $lotUuid) {
            $c = $this->verrouiller($candidatureUuid);
            $this->exigerTraitable($c, 'rejeter');

            $c->forceFill(array_merge(['statut' => 'rejetee', 'motif_rejet' => $motif], $this->traitement($lotUuid)))->save();

            AuditService::journaliser('REJET_CANDIDATURE', "Candidature {$c->reference} rejetée",
                ['candidature_uuid' => $c->uuid, 'motif' => $motif, 'lot_uuid' => $lotUuid]);

            return ['candidature_uuid' => $c->uuid, 'statut' => 'rejetee', 'motif_rejet' => $motif, 'message' => 'Candidature rejetée avec motif enregistré.'];
        });
    }

    /**
     * Traitement par lot : chaque dossier est décidé dans SA transaction ; l'échec de l'un n'annule pas les autres.
     *
     * @param  'valider'|'rejeter' $action
     * @param  string[]            $uuids
     */
    public function traiterLot(string $action, array $uuids, ?string $motif = null): array
    {
        $max = (int) config('inscription.lot_max', 50);
        $uuids = array_values(array_unique(array_filter($uuids, fn($u) => is_string($u) && Str::isUuid($u))));
        if (!$uuids) {
            throw new CandidatureException('Aucune candidature sélectionnée.', 'LOT_VIDE', 422);
        }
        if (count($uuids) > $max) {
            throw new CandidatureException("Un lot ne peut pas dépasser {$max} candidatures.", 'LOT_TROP_GRAND', 422);
        }
        if ($action === 'rejeter' && mb_strlen(trim((string) $motif)) < 5) {
            throw new CandidatureException('Le motif du rejet est obligatoire (5 caractères minimum).', 'MOTIF_INVALIDE', 422);
        }
        if ($action === 'valider') {
            $this->exigerModuleActif($this->tenant());   // une seule vérification pour tout le lot
        }

        $lotUuid = (string) Str::uuid();
        $resultats = [];
        foreach ($uuids as $u) {
            try {
                $r = $action === 'valider'
                    ? $this->validerCandidature($u, $lotUuid, false)
                    : $this->rejeterCandidature($u, (string) $motif, $lotUuid);
                $resultats[] = ['uuid' => $u, 'succes' => true, 'statut' => $r['statut']];
            } catch (CandidatureException $e) {
                $resultats[] = ['uuid' => $u, 'succes' => false, 'code' => $e->codeErreur, 'message' => $e->getMessage()];
            } catch (\Throwable $e) {
                report($e);
                $resultats[] = ['uuid' => $u, 'succes' => false, 'code' => 'ERREUR_SERVEUR', 'message' => 'Erreur inattendue sur ce dossier.'];
            }
        }

        $ok = count(array_filter($resultats, fn($r) => $r['succes']));
        AuditService::journaliser('TRAITEMENT_LOT_CANDIDATURES', "Lot {$action} : {$ok}/" . count($resultats),
            ['lot_uuid' => $lotUuid, 'action' => $action, 'total' => count($resultats), 'reussis' => $ok]);

        return ['lot_uuid' => $lotUuid, 'action' => $action, 'total' => count($resultats), 'reussis' => $ok, 'echecs' => count($resultats) - $ok, 'resultats' => $resultats];
    }

    // ───────────────────────────── internes ─────────────────────────────

    private function verrouiller(string $uuid): Candidature
    {
        $c = Candidature::where('uuid', $uuid)->lockForUpdate()->first();
        if (!$c) {
            throw new CandidatureException('Candidature introuvable.', 'CANDIDATURE_INTROUVABLE', 404);
        }

        return $c;
    }

    private function exigerTraitable(Candidature $c, string $action): void
    {
        if (in_array($c->statut, self::TRAITABLES, true)) {
            return;
        }
        throw match ($c->statut) {
            'validee' => $action === 'valider'
                ? new CandidatureException('Cette candidature a déjà été validée.', 'DEJA_VALIDEE', 409)
                : new CandidatureException('Une candidature validée ne peut plus être rejetée.', 'DEJA_VALIDEE', 409),
            'rejetee' => $action === 'rejeter'
                ? new CandidatureException('Cette candidature a déjà été rejetée.', 'DEJA_REJETEE', 409)
                : new CandidatureException('Une candidature rejetée ne peut plus être validée.', 'DEJA_REJETEE', 409),
            'en_attente_paiement' => new CandidatureException("Le paiement des frais n'est pas encore confirmé pour ce dossier.", 'PAIEMENT_NON_CONFIRME', 409),
            default => new CandidatureException('Ce dossier ne peut pas être traité dans son état actuel.', 'STATUT_NON_TRAITABLE', 409),
        };
    }

    private function traitement(?string $lotUuid): array
    {
        $u = app()->bound('current_user') ? app('current_user') : [];
        $auteur = $u['uuid'] ?? $u['sub'] ?? null;

        return [
            'traite_par_uuid' => is_string($auteur) && Str::isUuid($auteur) ? $auteur : null,
            'date_traitement' => now(),
            'lot_uuid'        => $lotUuid,
        ];
    }

    private function tenant(): int
    {
        try {
            return app(TenantResolver::class)->resoudreCourant();
        } catch (\Throwable $e) {
            throw new CandidatureException('Établissement de rattachement introuvable.', 'TENANT_INVALIDE', 403);
        }
    }

    private function exigerModuleActif(int $tenantId): void
    {
        if (!$this->etablissementsClient->estModuleActif($tenantId, 'inscription')) {
            throw new CandidatureException("Le module « Inscription » n'est pas actif pour cet établissement.", 'MODULE_INACTIF', 403);
        }
    }
}
