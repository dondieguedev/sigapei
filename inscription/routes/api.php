<?php

use App\appels_candidatures\AppelCandidatureController;
use App\appels_candidatures\AppelPublicController;
use App\candidatures\CandidatureController;
use App\candidatures\CandidaturePublicController;
use App\common\Middleware\VerifyTenantAndJwt;
use App\docs\DocsController;
use App\pieces_justificatives\PieceJustificativeController;
use App\reinscriptions\ReinscriptionController;
use App\tests_admission\TestAdmissionController;
use Illuminate\Support\Facades\Route;

// Sonde de sante (hors prefixe v1)
Route::get('/sante', function () {
    return response()->json([
        'statut'      => 'ok',
        'service'     => 'api-inscription',
        'horodatage'  => now()->toIso8601String(),
    ]);
});

// Documentation interactive Swagger UI (hors prefixe v1, comme sur api-identite et api-etablissements)
Route::get('/docs', [DocsController::class, 'interfaceSwagger']);
Route::get('/docs-json', [DocsController::class, 'specification']);

// Routes metier sous le prefixe v1, protegees par VerifyTenantAndJwt
// Roles identite utilisables : super_admin | administrateur | personnel | enseignant | apprenant | parent
Route::prefix('v1')->group(function () {

    // ── Routes PUBLIQUES (sans JWT) ─────────────────────────────────────────
    // Appels à candidature lisibles par tous les visiteurs (page publique étab)
    Route::get('/public/appels-candidatures',        [AppelPublicController::class, 'index']);
    Route::get('/public/appels-candidatures/{uuid}', [AppelPublicController::class, 'show']);

    // Candidature publique, sans compte : dépôt (multipart), suivi et paiement des frais.
    // Le tenant est résolu côté serveur depuis le slug ; contrôles : captcha, honeypot, limitation de débit.
    Route::post('/public/candidatures', [CandidaturePublicController::class, 'store']);
    Route::get('/public/candidatures/{reference}/suivi', [CandidaturePublicController::class, 'suivi']);
    Route::get('/public/candidatures/{reference}/paiement/modes', [CandidaturePublicController::class, 'modesPaiement']);
    Route::post('/public/candidatures/{reference}/paiement', [CandidaturePublicController::class, 'payer']);

    // ── Routes PROTÉGÉES (JWT requis) ───────────────────────────────────────
    Route::middleware([VerifyTenantAndJwt::class])->group(function () {

    // --- Appels à candidatures ---
    Route::get('/appels-candidatures', [AppelCandidatureController::class, 'index']);
    Route::get('/appels-candidatures/{uuid}', [AppelCandidatureController::class, 'show']);
    Route::post('/appels-candidatures', [AppelCandidatureController::class, 'store'])
        ->middleware('role:administrateur,personnel');
    Route::patch('/appels-candidatures/{uuid}', [AppelCandidatureController::class, 'update'])
        ->middleware('role:administrateur,personnel');
    Route::post('/appels-candidatures/{uuid}/terminer', [AppelCandidatureController::class, 'terminer'])
        ->middleware('role:administrateur,personnel');
    Route::delete('/appels-candidatures/{uuid}', [AppelCandidatureController::class, 'destroy'])
        ->middleware('role:administrateur');

    // --- Candidatures ---

    // Lecture : secretaire (personnel), directeur (administrateur), jury (enseignant)
    Route::get('/candidatures', [CandidatureController::class, 'index'])
        ->middleware('role:administrateur,personnel,enseignant');

    // Traitement par lot (déclaré AVANT /candidatures/{uuid}/... pour ne pas être capturé par le paramètre).
    // Validation : directeur uniquement. Rejet : directeur ou secrétaire. Motif unique pour tout le lot.
    Route::post('/candidatures/lot/valider', [CandidatureController::class, 'validerLot'])
        ->middleware('role:administrateur');
    Route::post('/candidatures/lot/rejeter', [CandidatureController::class, 'rejeterLot'])
        ->middleware('role:administrateur,personnel');

    // Saisie d'un dossier par le personnel. Le dépôt par le public passe par /public/candidatures :
    // plus AUCUNE exception d'authentification sur cette route.
    Route::post('/candidatures', [CandidatureController::class, 'store'])
        ->middleware('role:administrateur,personnel');

    // Consultation du dossier : secretaire, directeur, jury
    Route::get('/candidatures/{uuid}', [CandidatureController::class, 'show'])
        ->middleware('role:administrateur,personnel,enseignant');

    // Validation definitive : directeur uniquement (cree l'apprenant dans scolarite)
    Route::post('/candidatures/{uuid}/valider', [CandidatureController::class, 'valider'])
        ->middleware('role:administrateur');

    // Rejet avec motif : directeur ou secretaire
    Route::post('/candidatures/{uuid}/rejeter', [CandidatureController::class, 'rejeter'])
        ->middleware('role:administrateur,personnel');

    // --- Pieces justificatives ---
    // Les pièces sont déposées avec la candidature (chemin décidé par le serveur) : plus de route d'ajout libre.
    // Téléchargement/visualisation d'une pièce
    Route::get('/pieces-justificatives/{pieceUuid}/telecharger', [PieceJustificativeController::class, 'telecharger'])
        ->middleware('role:administrateur,personnel,enseignant');

    // --- Tests d'admission ---
    // Saisie des notes : jury enseignant ou directeur
    Route::post('/candidatures/{uuid}/tests-admission', [TestAdmissionController::class, 'store'])
        ->middleware('role:administrateur,enseignant');

    // --- Reinscriptions ---
    // Reconduite d'un apprenant vers une nouvelle classe : secretaire ou directeur
    Route::post('/reinscriptions', [ReinscriptionController::class, 'store'])
        ->middleware('role:administrateur,personnel');
    }); // fin groupe protégé VerifyTenantAndJwt
}); // fin prefix v1
