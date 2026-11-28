<?php

return [

    // Disque par défaut de l'application (les pièces de candidature utilisent INSCRIPTION_DISQUE_PIECES, voir inscription.php).
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [

        // Développement : fichiers PRIVÉS dans storage/app/private (jamais exposés directement).
        // `serve` active les URL temporaires signées (téléchargement des pièces par le personnel).
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => true,
            'report' => false,
        ],

        // Production : MinIO / S3 (bucket PRIVÉ). Requiert league/flysystem-aws-s3-v3.
        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
            'throw' => true,
            'report' => false,
        ],
    ],
];