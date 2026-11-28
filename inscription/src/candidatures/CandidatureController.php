<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\common\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class CandidatureController extends Controller
{
    public function __construct(
        protected CandidatureService $service,
        protected ValidationService $validation,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'statut'     => 'nullable|string|in:en_attente_paiement,soumise,en_attente,validee,rejetee,expiree',
            'appel_uuid' => 'nullable|uuid',
            'cycle'      => 'nullable|string|in:maternelle,primaire,secondaire,universitaire',
            'recherche'  => 'nullable|string|max:100',
        ]);
        $candidatures = $this->service->listerCandidatures($request->only(['statut', 'classe_visee_id', 'recherche', 'appel_uuid', 'cycle']));

        $appels = AppelCandidature::whereIn('uuid', $candidatures->pluck('appel_uuid')->filter()->unique())->get()->keyBy('uuid');

        $donnees = $candidatures->map(function (Candidature $c) use ($appels) {
            $a = $appels->get($c->appel_uuid);

            return [
                'uuid' => $c->uuid,
                'reference' => $c->reference,
                'nom' => $c->nom,
                'prenom' => $c->prenom,
                'date_naissance' => $c->date_naissance?->format('Y-m-d'),
                'sexe' => $c->sexe,
                'email' => $c->email,
                'telephone' => $c->telephone,
                'parent_nom' => $c->parent_nom,
                'parent_prenom' => $c->parent_prenom,
                'parent_telephone' => $c->parent_telephone,
                'classe_visee_id' => $c->classe_visee_id,
                'classe_visee' => $a ? ['nom' => $this->libelleCible($a)] : null,
                'appel' => $a ? ['uuid' => $a->uuid, 'titre' => $a->titre, 'cycle' => $a->cycle] : null,
                'statut' => $c->statut,
                'statut_paiement' => $c->statut_paiement,
                'motif_rejet' => $c->motif_rejet,
                'date_soumission' => $c->date_soumission?->toIso8601String(),
                'date_traitement' => $c->date_traitement?->toIso8601String(),
                'nb_pieces' => $c->piecesJustificatives->count(),
                'nb_tests' => $c->testsAdmission->count(),
            ];
        });

        return ApiResponse::succes($donnees, 'Liste des candidatures recuperee');
    }

    /** Saisie d'un dossier par le personnel (mêmes contrôles que la candidature publique). */
    public function store(Request $request): JsonResponse
    {
        $v = Validator::make($request->except(['fichiers']), [
            'appel_uuid' => 'required|uuid', 'nom' => 'required|string|max:100', 'prenom' => 'required|string|max:100',
            'date_naissance' => 'required|date', 'sexe' => 'nullable|string|in:M,F', 'email' => 'nullable|email|max:150',
            'telephone' => 'nullable|string|max:50', 'adresse' => 'nullable|string|max:255',
            'niveau_precedent' => 'nullable|string|max:150', 'etablissement_precedent' => 'nullable|string|max:150',
            'parent_nom' => 'nullable|string|max:100', 'parent_prenom' => 'nullable|string|max:100',
            'parent_telephone' => 'nullable|string|max:50', 'parent_email' => 'nullable|email|max:150',
            'parent_lien' => 'nullable|string|in:pere,mere,tuteur,parent', 'attestations' => 'nullable|array',
        ]);
        if ($v->fails()) {
            return ApiResponse::erreur('Certaines informations sont invalides.', 'DONNEES_INVALIDES', 422, collect($v->errors()->messages())->map(fn($m) => $m[0])->all());
        }

        return $this->reponse(function () use ($v, $request) {
            $c = $this->service->soumettreCandidature($v->validated(), (array) ($request->file('fichiers') ?? []));

            return ApiResponse::succes(['uuid' => $c->uuid, 'reference' => $c->reference, 'statut' => $c->statut,
                'date_soumission' => $c->date_soumission->toIso8601String()], 'Candidature soumise avec succes', 201);
        });
    }

    public function show(string $uuid): JsonResponse
    {
        return $this->reponse(fn() => ApiResponse::succes($this->service->consulterDetail($uuid), 'Detail de la candidature'));
    }

    public function valider(string $uuid): JsonResponse
    {
        return $this->reponse(fn() => ApiResponse::succes($this->service->valider($uuid), 'Candidature validee avec succes'));
    }

    public function rejeter(Request $request, string $uuid): JsonResponse
    {
        $validated = $request->validate(['motif' => 'required|string|min:5|max:500']);

        return $this->reponse(fn() => ApiResponse::succes($this->service->rejeter($uuid, $validated['motif']), 'Candidature rejetee'));
    }

    /** POST /candidatures/lot/valider - administrateur. */
    public function validerLot(Request $request): JsonResponse
    {
        $d = $request->validate(['uuids' => 'required|array|min:1|max:' . (int) config('inscription.lot_max', 50), 'uuids.*' => 'required|uuid']);

        return $this->reponse(fn() => ApiResponse::succes($this->validation->traiterLot('valider', $d['uuids']), 'Traitement du lot terminé'));
    }

    /** POST /candidatures/lot/rejeter - administrateur ou personnel. Motif unique pour tout le lot. */
    public function rejeterLot(Request $request): JsonResponse
    {
        $d = $request->validate([
            'uuids' => 'required|array|min:1|max:' . (int) config('inscription.lot_max', 50), 'uuids.*' => 'required|uuid',
            'motif' => 'required|string|min:5|max:500',
        ]);

        return $this->reponse(fn() => ApiResponse::succes($this->validation->traiterLot('rejeter', $d['uuids'], $d['motif']), 'Traitement du lot terminé'));
    }

    private function reponse(\Closure $f): JsonResponse
    {
        try {
            return $f();
        } catch (CandidatureException $e) {
            return ApiResponse::erreur($e->getMessage(), $e->codeErreur, $e->http, $e->details ?: null);
        } catch (\Throwable $e) {
            Log::error('[CANDIDATURE] ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);

            return ApiResponse::erreur('Une erreur est survenue.', 'ERREUR_SERVEUR', 500);
        }
    }

    private function libelleCible(AppelCandidature $a): string
    {
        return match ($a->cycle) {
            'secondaire' => trim(($a->promotion_nom ?: '') . ($a->serie_nom ? " ({$a->serie_nom})" : '')) ?: $a->titre,
            'universitaire' => $a->filiere_complete ?: ($a->departement_nom ?: $a->titre),
            default => $a->est_cycle_unique ? 'Cycle unique' : ($a->groupe_nom ?: $a->titre),
        };
    }
}
