<?php

namespace App\pieces_justificatives;

use App\common\Responses\ApiResponse;
use App\common\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Les pièces ne sont plus enregistrées par chemin fourni par le client : elles sont déposées avec la
 * candidature (PieceUploadService) et le chemin est construit par le serveur. Il ne reste que la consultation.
 */
class PieceJustificativeController extends Controller
{
    /** URL signée de très courte durée, après contrôle du cloisonnement par établissement et audit. */
    public function telecharger(string $pieceUuid): JsonResponse
    {
        try {
            $piece = PieceJustificative::where('uuid', $pieceUuid)->firstOrFail();   // TenantScope : son établissement uniquement

            $tenant = app()->bound('current_tenant_id') ? app('current_tenant_id') : null;
            $attendu = "tenants/{$tenant}/candidatures/";
            if ($tenant === null || !str_starts_with((string) $piece->chemin_stockage, $attendu) || str_contains((string) $piece->chemin_stockage, '..')) {
                Log::warning('[PIECE] Chemin hors périmètre du tenant', ['piece' => $piece->uuid]);

                return ApiResponse::erreur('Pièce introuvable ou inaccessible.', 'PIECE_INTROUVABLE', 404);
            }

            $url = Storage::disk(config('inscription.disque_pieces'))->temporaryUrl($piece->chemin_stockage, now()->addMinutes(2));

            AuditService::journaliser('CONSULTATION_PIECE', "Consultation de la pièce {$piece->uuid}",
                ['piece_uuid' => $piece->uuid, 'candidature_id' => $piece->candidature_id]);

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
