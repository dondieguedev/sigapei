<?php

namespace App\Console\Commands;

use App\candidatures\PaiementCandidatureService;
use Illuminate\Console\Command;

/** Libère les places des candidatures dont le paiement n'a pas été confirmé à temps. */
class ExpirerPaiementsCandidatures extends Command
{
    protected $signature = 'candidatures:expirer-paiements';
    protected $description = 'Expire les candidatures non réglées dans le délai et libère leurs places';

    public function handle(PaiementCandidatureService $service): int
    {
        $this->info($service->expirerEnAttente() . ' candidature(s) expirée(s).');

        return self::SUCCESS;
    }
}
