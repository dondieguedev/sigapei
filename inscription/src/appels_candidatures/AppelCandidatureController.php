<?php

namespace App\appels_candidatures;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AppelCandidatureController extends Controller
{
    public function __construct(
        private AppelCandidatureService $service,
    ) {}

    public function index(Request $request): JsonResponse    {

        $filtres = $request->only(['cycle', 'statut', 'annee_scolaire']);
        $appels = $this->service->lister($filtres);

        return response()->json([
            'succes' => true,
            'data'   => $appels,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $donnees = $request->validate($this->regles(true));
        $this->controlerCoherence($donnees);

        $appel = $this->service->creer($this->normaliser($donnees));

        return response()->json([
            'succes'  => true,
            'message' => 'Appel à candidature lancé avec succès.',
            'data'    => $appel,
        ], 201);
    }

    public function show(string $uuid): JsonResponse  {

        $appel = $this->service->trouverParUuid($uuid);

        return response()->json([
            'succes' => true,
            'data'   => $appel,
        ]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $donnees = $request->validate($this->regles(false));
        $this->controlerCoherence($donnees);

        $appel = $this->service->modifier($uuid, $this->normaliser($donnees));

        return response()->json([
            'succes'  => true,
            'message' => 'Appel à candidature mis à jour.',
            'data'    => $appel,
        ]);
    }

    public function terminer(string $uuid): JsonResponse   {

        $appel = $this->service->marquerTermine($uuid);

        return response()->json([
            'succes'  => true,
            'message' => 'Appel à candidature marqué comme terminé.',
            'data'    => $appel,
        ]);
    }

    public function destroy(string $uuid): JsonResponse    {
        
        $this->service->supprimer($uuid);

        return response()->json([
            'succes'  => true,
            'message' => 'Appel à candidature supprimé avec succès.',
        ]);
    }

    /** Schéma strict : ce que l'appel enregistre est exactement ce que le candidat verra et que le serveur appliquera. */
    private function regles(bool $creation): array
    {
        $p = $creation ? 'required' : 'sometimes';
        $n = $creation ? ['nullable'] : ['sometimes', 'nullable'];

        return [
            'cycle'                 => [$p, Rule::in(['maternelle', 'primaire', 'secondaire', 'universitaire'])],
            'annee_scolaire'        => [...$n, 'string', 'max:20'],
            'titre'                 => $creation ? ['nullable', 'string', 'max:255'] : ['sometimes', 'string', 'max:255'],
            'description'           => [...$n, 'string', 'max:5000'],
            'date_debut'            => [$p, 'date'],
            'date_fin'              => $creation ? ['required', 'date', 'after:date_debut'] : ['sometimes', 'date'],
            'est_payant'            => ['sometimes', 'boolean'],
            'montant'               => ['required_if:est_payant,true,1', ...$n, 'numeric', 'min:0', 'max:100000000'],
            'devise'                => [...$n, Rule::in(['XOF', 'XAF', 'GNF', 'CDF', 'FCFA'])],
            'places_disponibles'    => [...$n, 'integer', 'min:1'],
            'statut'                => ['sometimes', Rule::in(['brouillon', 'planifie', 'ouvert', 'termine', 'annule'])],
            'classe_visee_id'       => [...$n, 'integer'],
            'classe_uuid'           => [...$n, 'string', 'max:36'],

            'groupe_id'             => [...$n, 'integer'],
            'groupe_nom'            => [...$n, 'string', 'max:100'],
            'est_cycle_unique'      => ['sometimes', 'boolean'],
            'promotion_nom'         => [...$n, 'string', 'max:100'],
            'promotion_abreviation' => [...$n, 'string', 'max:50'],
            'serie_nom'             => [...$n, 'string', 'max:100'],
            'serie_code'            => [...$n, 'string', 'max:50'],
            'cycle_univ'            => [...$n, 'string', 'max:50'],
            'departement_nom'       => [...$n, 'string', 'max:100'],
            'option_nom'            => [...$n, 'string', 'max:100'],
            'niveau_etude'          => [...$n, 'string', 'max:100'],
            'filiere_complete'      => [...$n, 'string', 'max:255'],

            'criteres_eligibilite'                    => [...$n, 'array', 'max:30'],
            'criteres_eligibilite.*'                  => ['array'],
            'criteres_eligibilite.*.type'             => ['required', Rule::in(['age', 'type_inscription', 'texte', 'contact', 'niveau_scolaire', 'adresse', 'parent_tuteur'])],
            'criteres_eligibilite.*.label'            => ['nullable', 'string', 'max:255'],
            'criteres_eligibilite.*.obligatoire'      => ['nullable', 'boolean'],
            'criteres_eligibilite.*.date_min'         => ['nullable', 'date'],
            'criteres_eligibilite.*.date_max'         => ['nullable', 'date'],
            'criteres_eligibilite.*.mode'             => ['nullable', Rule::in(['concours', 'test', 'libre', 'selection'])],
            'criteres_eligibilite.*.matieres_composees'   => ['nullable', 'array', 'max:30'],
            'criteres_eligibilite.*.matieres_composees.*' => ['string', 'max:100'],
            'criteres_eligibilite.*.valeur_texte'     => ['nullable', 'string', 'max:1000'],
            'criteres_eligibilite.*.niveaux_acceptes'   => ['nullable', 'array', 'max:30'],
            'criteres_eligibilite.*.niveaux_acceptes.*' => ['string', 'max:100'],

            'pieces_fournir'                  => [...$n, 'array', 'max:30'],
            'pieces_fournir.*'                => ['array'],
            'pieces_fournir.*.libelle'        => ['required', 'string', 'max:255'],
            'pieces_fournir.*.format'         => ['nullable', 'string', 'max:50', 'regex:/^[A-Za-z ,;\/|.]+$/'],
            'pieces_fournir.*.obligatoire'    => ['nullable', 'boolean'],
        ];
    }

    private function controlerCoherence(array $d): void
    {
        foreach ((array) ($d['criteres_eligibilite'] ?? []) as $i => $c) {
            if (($c['type'] ?? null) === 'age' && !empty($c['date_min']) && !empty($c['date_max']) && $c['date_min'] > $c['date_max']) {
                throw ValidationException::withMessages(["criteres_eligibilite.{$i}.date_max" => 'La date maximale doit être postérieure ou égale à la date minimale.']);
            }
        }
    }

    private function normaliser(array $d): array
    {
        if (isset($d['devise']) && strtoupper($d['devise']) === 'FCFA') {
            $d['devise'] = 'XOF';
        }
        if (array_key_exists('est_payant', $d) && !$d['est_payant']) {
            $d['montant'] = 0;
        }

        return $d;
    }
}
