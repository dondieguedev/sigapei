<?php

namespace App\candidatures;

use App\common\Responses\ApiResponse;
use App\common\Services\CaptchaVerifier;
use App\common\Services\InterneClient;
use App\common\Services\TenantResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

/**
 * Candidature publique (sans compte) : dépôt, suivi et paiement des frais.
 *
 *  POST /v1/public/candidatures                                  multipart/form-data
 *  GET  /v1/public/candidatures/{reference}/suivi?slug=
 *  GET  /v1/public/candidatures/{reference}/paiement/modes?slug=
 *  POST /v1/public/candidatures/{reference}/paiement
 *
 * Toutes les exigences (critères, pièces, dates, places) sont contrôlées côté serveur par CriteresEvaluateur.
 */
class CandidaturePublicController extends Controller
{
    public function __construct(
        protected CandidatureService $service,
        protected PaiementCandidatureService $paiement,
        private TenantResolver $resolver,
        private InterneClient $interne,
        private CaptchaVerifier $captcha,
    ) {}

    public function store(Request $request): JsonResponse
    {
        try {
            // Anti-abus : plafond par IP (tout appel) avant tout travail coûteux.
            $cle = 'cand-pub:' . $request->ip();
            $max = (int) config('inscription.soumissions_max_par_10min', 10);
            if (RateLimiter::tooManyAttempts($cle, $max)) {
                return ApiResponse::erreur('Trop de tentatives. Réessayez dans quelques minutes.', 'TROP_DE_REQUETES', 429);
            }
            RateLimiter::hit($cle, 600);

            // Champ piège : invisible pour un humain. Réponse de succès factice pour ne rien apprendre au robot.
            if ($request->filled('site_web')) {
                return ApiResponse::succes(['reference' => 'SGP-0000-0000-0000-0000', 'statut' => 'soumise'], 'Candidature soumise avec succès.', 201);
            }

            if (!$this->captcha->verifier($request->input('captcha_token'), $request->ip())) {
                return ApiResponse::erreur('La vérification de sécurité a échoué. Veuillez réessayer.', 'CAPTCHA_INVALIDE', 422);
            }

            $this->resoudreEtablissement($request);

            $v = Validator::make($request->except(['fichiers']), [
                'appel_uuid'              => 'required|uuid',
                'nom'                     => 'required|string|max:100',
                'prenom'                  => 'required|string|max:100',
                'date_naissance'          => 'required|date',
                'sexe'                    => 'nullable|string|in:M,F',
                'email'                   => 'nullable|email|max:150',
                'telephone'               => 'nullable|string|max:50',
                'adresse'                 => 'nullable|string|max:255',
                'niveau_precedent'        => 'nullable|string|max:150',
                'etablissement_precedent' => 'nullable|string|max:150',
                'parent_nom'              => 'nullable|string|max:100',
                'parent_prenom'           => 'nullable|string|max:100',
                'parent_telephone'        => 'nullable|string|max:50',
                'parent_email'            => 'nullable|email|max:150',
                'parent_lien'             => 'nullable|string|in:pere,mere,tuteur,parent',
                'attestations'            => 'nullable|array',
                'attestations.*'          => 'nullable',
            ]);
            if ($v->fails()) {
                $details = [];
                foreach ($v->errors()->messages() as $champ => $msgs) {
                    $details[$champ] = $msgs[0];
                }

                return ApiResponse::erreur('Certaines informations sont invalides.', 'DONNEES_INVALIDES', 422, $details);
            }

            $fichiers = (array) ($request->file('fichiers') ?? []);
            $candidature = $this->service->soumettreCandidature($v->validated(), $fichiers);

            return ApiResponse::succes($this->paiement->suivi($candidature), 'Candidature soumise avec succès.', 201);
        } catch (CandidatureException $e) {
            return ApiResponse::erreur($e->getMessage(), $e->codeErreur, $e->http, $e->details ?: null);
        } catch (\Throwable $e) {
            Log::error('[CANDIDATURE-PUBLIQUE] ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);

            return ApiResponse::erreur("Une erreur est survenue. Votre candidature n'a pas été enregistrée.", 'ERREUR_SERVEUR', 500);
        }
    }

    public function suivi(Request $request, string $reference): JsonResponse
    {
        return $this->avecCandidature($request, $reference, fn(Candidature $c) => ApiResponse::succes($this->paiement->synchroniser($c), 'Suivi de la candidature'));
    }

    public function modesPaiement(Request $request, string $reference): JsonResponse
    {
        return $this->avecCandidature($request, $reference, function (Candidature $c) {
            // Un paiement déjà réglé en parallèle doit être pris en compte avant de proposer quoi que ce soit.
            $this->paiement->synchroniser($c);

            return ApiResponse::succes($this->paiement->modes($c->refresh()), 'Moyens de paiement disponibles');
        });
    }

    public function payer(Request $request, string $reference): JsonResponse
    {
        return $this->avecCandidature($request, $reference, function (Candidature $c) use ($request) {
            $v = Validator::make($request->all(), [
                'agregateur' => 'required|string|regex:/^[a-z]{3,20}$/',
                'url_retour' => 'required|string|max:500',
            ]);
            if ($v->fails()) {
                return ApiResponse::erreur('Paramètres de paiement invalides.', 'DONNEES_INVALIDES', 422, $v->errors()->toArray());
            }

            return ApiResponse::succes($this->paiement->initier($c, $v->validated()['agregateur'], $v->validated()['url_retour']), 'Paiement initié');
        });
    }

    // ───────────────────────────── internes ─────────────────────────────

    private function avecCandidature(Request $request, string $reference, \Closure $action): JsonResponse
    {
        try {
            $cle = 'cand-suivi:' . $request->ip();
            if (RateLimiter::tooManyAttempts($cle, 60)) {
                return ApiResponse::erreur('Trop de requêtes. Réessayez dans quelques instants.', 'TROP_DE_REQUETES', 429);
            }
            RateLimiter::hit($cle, 60);

            $this->resoudreEtablissement($request);
            if (!preg_match('/^SGP-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/', $reference)) {
                throw new CandidatureException('Numéro de suivi introuvable.', 'CANDIDATURE_INTROUVABLE', 404);
            }
            $c = Candidature::where('reference', $reference)->first();
            if (!$c) {
                throw new CandidatureException('Numéro de suivi introuvable.', 'CANDIDATURE_INTROUVABLE', 404);
            }

            return $action($c);
        } catch (CandidatureException $e) {
            return ApiResponse::erreur($e->getMessage(), $e->codeErreur, $e->http, $e->details ?: null);
        } catch (\Throwable $e) {
            Log::error('[CANDIDATURE-PUBLIQUE] ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);

            return ApiResponse::erreur('Une erreur est survenue.', 'ERREUR_SERVEUR', 500);
        }
    }

    /** Résout l'établissement (slug ou UUID) et publie le tenant pour le TenantScope. */
    private function resoudreEtablissement(Request $request): void
    {
        $slug = (string) ($request->input('slug') ?? $request->query('slug') ?? $request->header('X-Etablissement-Slug') ?? '');
        $uuid = (string) ($request->input('etablissement_uuid') ?? $request->query('etablissement_uuid') ?? '');

        if ($slug === '' && $uuid === '') {
            throw new CandidatureException('Paramètre slug ou etablissement_uuid requis.', 'TENANT_MANQUANT', 422);
        }
        if ($uuid === '') {
            if (!preg_match('/^[a-z0-9][a-z0-9-]{0,79}$/', $slug)) {   // le slug entre dans une URL interne : format strict
                throw new CandidatureException('Établissement introuvable.', 'TENANT_INVALIDE', 404);
            }
            try {
                $r = $this->interne->get('etablissements', "/v1/interne/resolution-slug/{$slug}");
                $uuid = (string) ($r['tenantUuid'] ?? $r['uuid'] ?? '');
            } catch (\Throwable) {
                $uuid = '';
            }
        }
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $uuid)) {
            throw new CandidatureException('Établissement introuvable.', 'TENANT_INVALIDE', 404);
        }
        try {
            $tenantId = $this->resolver->resoudre($uuid);
        } catch (\Throwable) {
            throw new CandidatureException('Établissement introuvable.', 'TENANT_INVALIDE', 404);
        }

        app()->instance('current_tenant_id', $tenantId);
        app()->instance('current_tenant_ref', $uuid);
    }
}
