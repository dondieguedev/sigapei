<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use Illuminate\Database\Eloquent\Collection;

class CandidatureRepository
{
    public function lister(array $filtres = []): Collection
    {
        $query = Candidature::query()->with(['piecesJustificatives', 'testsAdmission']);

        if (!empty($filtres['statut'])) {
            $query->where('statut', $filtres['statut']);
        } else {
            // File de traitement par défaut : ni dossiers non réglés, ni dossiers expirés.
            $query->whereNotIn('statut', ['en_attente_paiement', 'expiree']);
        }

        if (!empty($filtres['appel_uuid'])) {
            $query->where('appel_uuid', $filtres['appel_uuid']);
        }

        if (!empty($filtres['cycle'])) {
            $query->whereIn('appel_uuid', AppelCandidature::where('cycle', $filtres['cycle'])->select('uuid'));
        }

        if (!empty($filtres['classe_visee_id'])) {
            $query->where('classe_visee_id', $filtres['classe_visee_id']);
        }

        if (!empty($filtres['recherche'])) {
            $r = $filtres['recherche'];
            $query->where(function ($q) use ($r) {
                $q->where('nom', 'ILIKE', "%{$r}%")
                  ->orWhere('prenom', 'ILIKE', "%{$r}%")
                  ->orWhere('email', 'ILIKE', "%{$r}%")
                  ->orWhere('telephone', 'ILIKE', "%{$r}%");
            });
        }

        return $query->orderBy('date_soumission', 'desc')->get();
    }

    public function trouverParUuid(string $uuid): ?Candidature
    {
        return Candidature::where('uuid', $uuid)
            ->with(['piecesJustificatives', 'testsAdmission'])
            ->first();
    }

    public function trouverParId(int $id): ?Candidature
    {
        return Candidature::find($id);
    }

    public function creer(array $donnees): Candidature
    {
        return Candidature::create($donnees);
    }

    public function mettreAJour(Candidature $candidature, array $donnees): Candidature
    {
        $candidature->update($donnees);
        return $candidature;
    }
}
