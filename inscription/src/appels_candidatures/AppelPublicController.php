<?php

namespace App\appels_candidatures;

use App\candidatures\CriteresEvaluateur;
use App\common\Services\InterneClient;
use App\common\Services\TenantResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

/**
 * Endpoint PUBLIC - Appels à candidature d'un établissement.
 *
 * Accessible sans JWT. L'établissement est identifié par son slug ou
 * son UUID fourni en query string.
 *
 * GET /v1/public/appels-candidatures?slug={slug}&cycle={cycle}
 * GET /v1/public/appels-candidatures?etablissement_uuid={uuid}&cycle={cycle}
 */
class AppelPublicController extends Controller
{
    public function __construct(
        private AppelCandidatureService $service,
        private TenantResolver $resolver,
        private InterneClient $interne,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $slug              = $request->query('slug');
        $etablissementUuid = $request->query('etablissement_uuid');

        if (empty($slug) && empty($etablissementUuid)) {
            return response()->json([
                'succes'  => false,
                'message' => 'Paramètre slug ou etablissement_uuid requis.',
            ], 422);
        }

        // Si slug fourni sans UUID : résoudre via l'endpoint de résolution
        if (!empty($slug) && empty($etablissementUuid)) {
            if (!preg_match('/^[a-z0-9][a-z0-9-]{0,79}$/', (string) $slug)) {   // le slug entre dans une URL interne
                return response()->json(['succes' => false, 'message' => 'Établissement introuvable.'], 404);
            }
            try {
                $reponse = $this->interne->get('etablissements', "/v1/interne/resolution-slug/{$slug}");
                $etablissementUuid = $reponse['tenantUuid'] ?? $reponse['uuid'] ?? null;
            } catch (\Throwable) {
                $etablissementUuid = null;
            }
            if (empty($etablissementUuid)) {
                return response()->json(['succes' => false, 'message' => 'Établissement introuvable.'], 404);
            }
        }

        // Résoudre l'UUID → tenant_id
        try {
            $tenantId = $this->resolver->resoudre($etablissementUuid);
        } catch (\Throwable $e) {
            return response()->json([
                'succes'  => false,
                'message' => 'Établissement introuvable.',
            ], 404);
        }

        // Publier le tenant dans le conteneur pour que TenantScope s'applique
        app()->instance('current_tenant_id', $tenantId);
        app()->instance('current_tenant_ref', $etablissementUuid);

        $filtres = $request->only(['cycle', 'statut', 'annee_scolaire']);

        // Public : appels ouverts ou annoncés. Les brouillons, terminés et annulés ne sont jamais exposés.
        $appels = AppelCandidature::query()
            ->whereIn('statut', ['ouvert', 'planifie'])
            ->when(!empty($filtres['cycle']),          fn($q) => $q->where('cycle', $filtres['cycle']))
            ->when(!empty($filtres['annee_scolaire']), fn($q) => $q->where('annee_scolaire', $filtres['annee_scolaire']))
            ->orderBy('date_debut', 'asc')
            ->get()
            ->map(fn(AppelCandidature $x) => $this->presenter($x));

        return response()->json([
            'succes' => true,
            'data'   => $appels,
        ]);
    }

    public function show(string $uuid): JsonResponse
    {
        try {
            $appel = AppelCandidature::withoutGlobalScopes()->where('uuid', $uuid)->firstOrFail();

            if (!in_array($appel->statut, ['ouvert', 'planifie'], true)) {
                return response()->json(['succes' => false, 'message' => 'Appel non disponible.'], 404);
            }

            return response()->json(['succes' => true, 'data' => $this->presenter($appel)]);
        } catch (\Throwable) {
            return response()->json(['succes' => false, 'message' => 'Appel introuvable.'], 404);
        }
    }

    /** Appel + schéma du formulaire (critères lisibles, pièces, frais, étapes) calculé par le serveur. */
    private function presenter(AppelCandidature $appel): array
    {
        $donnees = $appel->makeHidden(['id', 'tenant_id'])->toArray();
        $formulaire = CriteresEvaluateur::schema($appel);
        $donnees['formulaire'] = $formulaire;
        $donnees['accepte_candidatures'] = $appel->accepteCandidatures() && ($appel->places_disponibles === null || $appel->places_disponibles > 0);
        $donnees['devise'] = CriteresEvaluateur::devise($appel);

        return $donnees;
    }
}
