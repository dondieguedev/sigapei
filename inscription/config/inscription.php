<?php

return [
    // Taille maximale d'une pièce justificative (5 Mo par défaut).
    'piece_max_octets' => (int) env('INSCRIPTION_PIECE_MAX_OCTETS', 5 * 1024 * 1024),

    // Disque de stockage des pièces (S3 / MinIO en production).
    'disque_pieces' => env('INSCRIPTION_DISQUE_PIECES', env('FILESYSTEM_DISK', 'local')),

    // Délai laissé au candidat pour régler avant libération de sa place (le service Paiements fixe l'expiration réelle).
    'paiement_expiration_minutes' => (int) env('INSCRIPTION_PAIEMENT_EXPIRATION_MINUTES', 30),

    // Nombre maximal de dossiers traités en un seul lot.
    'lot_max' => (int) env('INSCRIPTION_LOT_MAX', 50),

    // Soumissions publiques : tentatives par IP et par appel, sur 10 minutes.
    'soumissions_max_par_10min' => (int) env('INSCRIPTION_SOUMISSIONS_MAX', 10),

    // Origines autorisées pour l'adresse de retour de paiement (liste séparée par des virgules).
    'origines_retour' => array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ORIGINS', ''))))),

    'captcha' => [
        'fournisseur'  => env('CAPTCHA_PROVIDER', 'recaptcha'),     // recaptcha | none
        'score_min'    => (float) env('CAPTCHA_MIN_SCORE', 0.5),
        'cle_api'      => env('RECAPTCHA_API_KEY'),                 // Enterprise
        'cle_site'     => env('RECAPTCHA_SITE_KEY'),                // Enterprise
        'projet_id'    => env('RECAPTCHA_PROJECT_ID'),              // Enterprise
        'cle_secrete'  => env('CAPTCHA_SECRET_KEY'),                // reCAPTCHA standard (repli)
        'action'       => env('CAPTCHA_ACTION_CANDIDATURE', ''),    // vide = action non contrôlée
    ],
];
