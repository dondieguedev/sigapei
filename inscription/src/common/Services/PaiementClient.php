<?php

namespace App\common\Services;

use RuntimeException;

/** Appels serveur à serveur vers le microservice Paiements (jamais depuis le navigateur). */
class PaiementClient
{
    public function __construct(private InterneClient $interne) {}

    /** @return array{devise:string, agregateurs:array<int,array<string,mixed>>} */
    public function modes(string $etablissementUuid, string $devise, int $montant): array
    {
        $r = $this->interne->get('paiements', "/v1/interne/etablissements/{$etablissementUuid}/modes-encaissement", [
            'devise' => $devise, 'montant' => $montant,
        ]);

        return ['devise' => $devise, 'agregateurs' => $r['agregateurs'] ?? []];
    }

    /** @return array<string,mixed> {uuid, referenceMarchande, urlPaiement, statut} */
    public function initier(string $etablissementUuid, array $payload): array
    {
        return $this->interne->post('paiements', "/v1/etablissements/{$etablissementUuid}/encaissements", $payload);
    }

    /** @return array<string,mixed>|null null si aucun encaissement n'existe encore */
    public function statutParObjet(string $etablissementUuid, string $type, string $objetUuid): ?array
    {
        return $this->interne->get('paiements', "/v1/interne/etablissements/{$etablissementUuid}/encaissements/par-objet/{$type}/{$objetUuid}");
    }
}
