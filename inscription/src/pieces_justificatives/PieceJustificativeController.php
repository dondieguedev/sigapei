<?php

namespace App\pieces_justificatives;

use App\common\Responses\ApiResponse;
use App\pieces_justificatives\PieceJustificative;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class PieceJustificativeController extends Controller
{
    public function __construct(
        protected PieceJustificativeService $service
    ) {}

    public function store(Request $request, string $uuid): JsonResponse
    {
        $validated = $request->validate([
            'type' => 'required|string|in:bulletin,acte_naissance,certificat_nationalite,photo,autre',
            'nom_original' => 'required|string|max:255',
            'chemin_stockage' => 'required|string|max:500',
            'taille_octets' => 'nullable|integer',
            'mime_type' => 'nullable|string|max:100',
        ]);

        try {
            $piece = $this->service->ajouterPiece($uuid, $validated);

            return ApiResponse::succes([
                'uuid' => $piece->uuid,
                'type' => $piece->type,
                'nom_original' => $piece->nom_original,
                'chemin_stockage' => $piece->chemin_stockage,
                'statut_validation' => $piece->statut_validation,
            ], 'Piece justificative enregistree avec succes', 201);
        } catch (\Throwable $e) {
            return ApiResponse::erreur($e->getMessage(), 'ERREUR_AJOUT_PIECE', 400);
        }
    }

    /**
     * Télécharger / visualiser une pièce justificative.
     * Génère une URL signée temporaire (5 min) depuis S3/MinIO.
     */
    public function telecharger(string $pieceUuid): \Illuminate\Http\Response|JsonResponse
    {
        try {
            $piece = PieceJustificative::where('uuid', $pieceUuid)->firstOrFail();

            // Générer URL signée temporaire depuis le stockage objet
            $url = \Illuminate\Support\Facades\Storage::temporaryUrl(
                $piece->chemin_stockage,
                now()->addMinutes(5)
            );

            return response()->json([
                'succes'       => true,
                'url'          => $url,
                'nom_original' => $piece->nom_original,
                'mime_type'    => $piece->mime_type,
            ]);
        } catch (\Throwable $e) {
            return ApiResponse::erreur('Pièce introuvable ou inaccessible.', 'PIECE_INTROUVABLE', 404);
        }
    }
}
