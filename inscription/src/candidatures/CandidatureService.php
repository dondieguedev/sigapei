<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\common\Services\AuditService;
use Exception;
use Illuminate\Database\Eloquent\Collection;

class CandidatureService
{
    public function __construct(
        protected CandidatureRepository $repository,
        protected ValidationService $validationService
    ) {}

    public function listerCandidatures(array $filtres = []): Collection
    {
        return $this->repository->lister($filtres);
    }

    public function soumettreCandidature(array $donnees): Candidature
    {
        // ── Vérification de l'appel à candidature ──────────────────────
        if (!empty($donnees['appel_uuid'])) {
            $appel = AppelCandidature::where('uuid', $donnees['appel_uuid'])->first();

            if (!$appel) {
                throw new Exception("L'appel à candidature est introuvable.");
            }

            $now = now();

            // Statut administratif bloquant
            if (in_array($appel->statut, ['termine', 'annule'], true)) {
                throw new Exception("Cet appel à candidature est clôturé. Les inscriptions ne sont plus acceptées.");
            }

            // Pas encore ouvert
            if ($appel->date_debut && $now->lt($appel->date_debut)) {
                $dateOuverture = $appel->date_debut->translatedFormat('d F Y à H:i');
                throw new Exception("Cet appel n'est pas encore ouvert. L'ouverture est prévue le {$dateOuverture}.");
            }

            // Clôturé par la date de fin
            if ($appel->date_fin && $now->gt($appel->date_fin)) {
                $dateCloture = $appel->date_fin->translatedFormat('d F Y à H:i');
                throw new Exception("Cet appel à candidature est clôturé depuis le {$dateCloture}. Les inscriptions ne sont plus acceptées.");
            }

            // Statut doit être ouvert (ou brouillon/planifié dans les dates)
            if ($appel->statut === 'brouillon' || $appel->statut === 'planifie') {
                // Accepté seulement si la date_debut est passée (déjà vérifié ci-dessus)
                // On autorise si on est dans la fenêtre
            } elseif ($appel->statut !== 'ouvert') {
                throw new Exception("Cet appel à candidature n'est pas ouvert aux inscriptions.");
            }

            // Vérifier les places disponibles
            if ($appel->places_disponibles !== null && $appel->places_disponibles <= 0) {
                throw new Exception("Toutes les places disponibles pour cet appel ont été pourvues.");
            }

            // ── Reprendre classe_visee_id depuis l'appel configuré ──
            if (!empty($appel->classe_visee_id)) {
                $donnees['classe_visee_id'] = $appel->classe_visee_id;
            }

            // ── Vérifier les critères d'éligibilité configurés ──
            $criteres = $appel->criteres_eligibilite ?? [];
            foreach ($criteres as $critere) {
                $type = $critere['type'] ?? null;

                // Critère âge / date de naissance
                if ($type === 'age') {
                    if (empty($donnees['date_naissance'])) {
                        throw new Exception("La date de naissance est obligatoire pour cet appel.");
                    }
                    $dateNaissance = \Carbon\Carbon::parse($donnees['date_naissance']);
                    $dateMin = !empty($critere['date_min']) ? \Carbon\Carbon::parse($critere['date_min']) : null;
                    $dateMax = !empty($critere['date_max']) ? \Carbon\Carbon::parse($critere['date_max']) : null;

                    if ($dateMin && $dateNaissance->lt($dateMin)) {
                        throw new Exception(
                            "Critère d'âge non respecté : la date de naissance doit être après le " .
                            $dateMin->translatedFormat('d F Y') . "."
                        );
                    }
                    if ($dateMax && $dateNaissance->gt($dateMax)) {
                        throw new Exception(
                            "Critère d'âge non respecté : la date de naissance doit être avant le " .
                            $dateMax->translatedFormat('d F Y') . "."
                        );
                    }
                }

                // Critère modalité d'admission
                if ($type === 'type_inscription') {
                    if (empty($donnees['type_inscription'])) {
                        throw new Exception("La modalité d'admission est obligatoire pour cet appel.");
                    }
                }

                // Critère contact
                if ($type === 'contact') {
                    if (empty($donnees['telephone']) && empty($donnees['email'])) {
                        throw new Exception("Un numéro de téléphone ou une adresse e-mail est requis pour cet appel.");
                    }
                }

                // Critère niveau scolaire précédent
                if ($type === 'niveau_scolaire') {
                    if (empty($donnees['niveau_precedent'])) {
                        throw new Exception("Le niveau scolaire précédent est obligatoire pour cet appel.");
                    }
                }

                // Critère parent / tuteur
                if ($type === 'parent_tuteur') {
                    if (empty($donnees['parent_nom'])) {
                        throw new Exception("Le nom du parent ou tuteur est obligatoire pour cet appel.");
                    }
                    if (empty($donnees['parent_telephone'])) {
                        throw new Exception("Le téléphone du parent ou tuteur est obligatoire pour cet appel.");
                    }
                }

                // Critère adresse
                if ($type === 'adresse') {
                    if (empty($donnees['adresse'])) {
                        throw new Exception("L'adresse est obligatoire pour cet appel.");
                    }
                }
            }
            // ── Fin vérification critères ──
        }
        // ───────────────────────────────────────────────────────────────

        $donnees['statut']          = 'soumise';
        $donnees['date_soumission'] = now();

        // Nettoyer les champs inconnus / non fillable pour éviter les erreurs de masse
        $champsAutorise = [
            'appel_uuid', 'nom', 'prenom', 'date_naissance', 'sexe',
            'email', 'telephone', 'adresse',
            'type_inscription', 'niveau_precedent', 'etablissement_precedent',
            'classe_visee_id',
            'parent_nom', 'parent_prenom', 'parent_telephone', 'parent_email', 'parent_lien',
            'statut', 'date_soumission',
        ];
        $donnees = array_filter(
            array_intersect_key($donnees, array_flip($champsAutorise)),
            fn($v) => $v !== null && $v !== ''
        );
        // Réintégrer les champs obligatoires
        $donnees['statut']          = 'soumise';
        $donnees['date_soumission'] = now();

        $candidature = $this->repository->creer($donnees);

        // Décrémenter les places si applicable
        if (!empty($donnees['appel_uuid']) && isset($appel) && $appel->places_disponibles !== null) {
            $appel->decrement('places_disponibles');
        }

        AuditService::journaliser(
            'SOUMISSION_CANDIDATURE',
            "Nouvelle candidature pour {$candidature->nom} {$candidature->prenom}",
            ['uuid' => $candidature->uuid, 'appel_uuid' => $donnees['appel_uuid'] ?? null]
        );

        return $candidature;
    }

    public function consulterDetail(string $uuid): array
    {
        $candidature = $this->repository->trouverParUuid($uuid);
        if (!$candidature) {
            throw new Exception("Candidature introuvable.");
        }

        return [
            'uuid'            => $candidature->uuid,
            'nom'             => $candidature->nom,
            'prenom'          => $candidature->prenom,
            'date_naissance'  => $candidature->date_naissance?->format('Y-m-d'),
            'sexe'            => $candidature->sexe,
            'email'           => $candidature->email,
            'telephone'       => $candidature->telephone,
            'adresse'         => $candidature->adresse,
            'statut'          => $candidature->statut,
            'appel_uuid'      => $candidature->appel_uuid,
            'date_soumission' => $candidature->date_soumission?->toIso8601String(),
            'motif_rejet'     => $candidature->motif_rejet,
            'parent'          => [
                'nom'       => $candidature->parent_nom,
                'prenom'    => $candidature->parent_prenom,
                'telephone' => $candidature->parent_telephone,
                'email'     => $candidature->parent_email,
                'lien'      => $candidature->parent_lien,
            ],
            'pieces_justificatives' => $candidature->piecesJustificatives->map(fn($p) => [
                'uuid'               => $p->uuid,
                'type'               => $p->type,
                'nom_original'       => $p->nom_original,
                'chemin_stockage'    => $p->chemin_stockage,
                'statut_validation'  => $p->statut_validation,
            ]),
            'tests_admission' => $candidature->testsAdmission->map(fn($t) => [
                'uuid'       => $t->uuid,
                'type_test'  => $t->type_test,
                'matiere'    => $t->matiere,
                'note'       => $t->note,
                'note_max'   => $t->note_max,
                'resultat'   => $t->resultat,
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
}
