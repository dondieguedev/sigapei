<?php

namespace App\candidatures;

use RuntimeException;

/** Erreur métier portant un code stable, un statut HTTP et, le cas échéant, des erreurs par champ. */
class CandidatureException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $codeErreur = 'ERREUR_CANDIDATURE',
        public readonly int $http = 400,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
