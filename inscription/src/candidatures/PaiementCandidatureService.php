<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\common\Services\AuditService;
use App\common\Services\PaiementClient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Paiement des frais de candidature via le microservice Paiements.
 *  - le montant et la devise viennent de l'appel (enregistrés sur le dossier), jamais du client ;
 *  - seuls les modes réellement accordés à l'établissement sont proposés (décidé par Paiements) ;
 *  - le dossier ne passe à « soumise » que sur confirmation serveur à serveur de Paiements.
 */
class PaiementCandidatureService
{
    public function __construct(private PaiementClient $paiements) {}

    public function modes(Candidature $c): array
    {
        $this->exigerEnAttente($c);

        try {
            return $this->paiements->modes($this->etablissement($c), (string) $c->devise_paiement, $this->montantEntier($c));
        } catch (\RuntimeException $e) {
            Log::warning('[PAIEMENT-CANDIDATURE] Modes indisponibles : ' . $e->getMessage());
            throw new CandidatureException('Le paiement en ligne est momentanément indisponible.', 'PAIEMENT_INDISPONIBLE', 503);
        }
    }

    public function initier(Candidature $c, string $agregateurCode, ?string $urlRetour): array
    {
        $this->exigerEnAttente($c);
        if (!preg_match('/^[a-z]{3,20}$/', $agregateurCode)) {
            throw new CandidatureException('Moyen de paiement invalide.', 'AGREGATEUR_INVALIDE', 422);
        }
        $urlRetour = $this->urlRetourAutorisee($urlRetour);

        $parent = !empty($c->parent_telephone) || !empty($c->parent_email);
        $payload = [
            'agregateurCode' => $agregateurCode,
            'montant'        => $this->montantEntier($c),
            'devise'         => (string) $c->devise_paiement,
            'libelle'        => "Frais de candidature {$c->reference}",
            'objetType'      => 'candidature',
            'objetUuid'      => $c->uuid,
            'urlRetour'      => $urlRetour,
            'payeur'         => array_filter([
                'nom'       => $parent ? ($c->parent_nom ?: $c->nom) : $c->nom,
                'prenom'    => $parent ? ($c->parent_prenom ?: $c->prenom) : $c->prenom,
                'email'     => $c->parent_email ?: $c->email,
                'telephone' => $c->parent_telephone ?: $c->telephone,
                'pays'      => 'BJ',
            ]),
        ];

        try {
            $r = $this->paiements->initier($this->etablissement($c), $payload);
        } catch (\RuntimeException $e) {
            Log::warning('[PAIEMENT-CANDIDATURE] Initiation refusée : ' . $e->getMessage());
            throw new CandidatureException("Le paiement n'a pas pu être initié avec ce moyen. Choisissez-en un autre ou réessayez.", 'PAIEMENT_REFUSE', 502);
        }

        $suivi = $this->synchroniser($c);   // récupère l'expiration réelle fixée par Paiements

        return [
            'url_paiement'        => $r['urlPaiement'] ?? null,
            'reference_marchande' => $r['referenceMarchande'] ?? null,
            'agregateur'          => $agregateurCode,
            'expire_le'           => $suivi['expire_le'],
        ];
    }

    /** Interroge Paiements et applique la confirmation si le paiement est approuvé. */
    public function synchroniser(Candidature $c): array
    {
        if ($c->statut === 'en_attente_paiement' || $c->statut === 'expiree') {
            try {
                $r = $this->paiements->statutParObjet($this->etablissement($c), 'candidature', $c->uuid);
            } catch (\RuntimeException $e) {
                Log::warning('[PAIEMENT-CANDIDATURE] Statut indisponible : ' . $e->getMessage());
                throw new CandidatureException('La vérification du paiement est momentanément impossible. Réessayez dans un instant.', 'PAIEMENT_INDISPONIBLE', 503);
            }

            if ($r && in_array($r['statut'] ?? null, ['approuve', 'disponible'], true)) {
                $this->confirmer($c);
            } elseif ($r && !empty($r['expireLe']) && $c->statut === 'en_attente_paiement') {
                // L'expiration est portée par le service Paiements (paramétrable chez lui) ; plafonnée à 2 h après le dépôt.
                $plafond = $c->date_soumission?->copy()->addHours(2);
                $exp = \Carbon\Carbon::parse($r['expireLe']);
                $c->paiement_expire_le = $plafond && $exp->gt($plafond) ? $plafond : $exp;
                $c->save();
            }
            $c->refresh();
        }

        return $this->suivi($c, $r['statut'] ?? null);
    }

    public function suivi(Candidature $c, ?string $statutPaiementService = null): array
    {
        return [
            'reference'        => $c->reference,
            'statut'           => $c->statut,
            'statut_paiement'  => $c->statut_paiement,
            'paiement_requis'  => $c->statut_paiement !== null,
            'montant'          => $c->montant_du !== null ? (float) $c->montant_du : null,
            'devise'           => $c->devise_paiement,
            'expire_le'        => $c->paiement_expire_le?->toIso8601String(),
            'statut_transaction' => $statutPaiementService,
            'date_soumission'  => $c->date_soumission?->toIso8601String(),
        ];
    }

    /** Passage « en attente de paiement » → « soumise », idempotent et sous verrou. */
    public function confirmer(Candidature $c): void
    {
        DB::transaction(function () use ($c) {
            $x = Candidature::where('id', $c->id)->lockForUpdate()->first();
            if (!$x) {
                return;
            }
            if ($x->statut === 'en_attente_paiement') {
                $x->forceFill(['statut' => 'soumise', 'statut_paiement' => 'paye', 'paiement_expire_le' => null])->save();
                AuditService::journaliser('PAIEMENT_CANDIDATURE_CONFIRME', "Paiement confirmé pour {$x->reference}", ['candidature_uuid' => $x->uuid]);
            } elseif ($x->statut === 'expiree' && $x->statut_paiement !== 'paye') {
                // Paiement tardif : on reprend la place si elle existe encore, sinon remboursement à traiter.
                $appel = AppelCandidature::withoutGlobalScopes()->where('uuid', $x->appel_uuid)->lockForUpdate()->first();
                if ($appel && ($appel->places_disponibles === null || $appel->places_disponibles > 0) && $appel->statut === 'ouvert') {
                    if ($appel->places_disponibles !== null) {
                        $appel->decrement('places_disponibles');
                    }
                    $x->forceFill(['statut' => 'soumise', 'statut_paiement' => 'paye'])->save();
                    AuditService::journaliser('PAIEMENT_TARDIF_ACCEPTE', "Paiement tardif accepté pour {$x->reference}", ['candidature_uuid' => $x->uuid]);
                } else {
                    $x->forceFill(['statut_paiement' => 'a_rembourser'])->save();
                    AuditService::journaliser('PAIEMENT_TARDIF_A_REMBOURSER', "Paiement tardif à rembourser pour {$x->reference}", ['candidature_uuid' => $x->uuid]);
                }
            }
        });
    }

    /** Libère les places des dossiers non réglés à temps. À planifier chaque minute. */
    public function expirerEnAttente(): int
    {
        $n = 0;
        $ids = Candidature::withoutGlobalScopes()
            ->where('statut', 'en_attente_paiement')->where('paiement_expire_le', '<', now())
            ->orderBy('id')->limit(200)->pluck('id');

        foreach ($ids as $id) {
            $c = Candidature::withoutGlobalScopes()->find($id);
            if (!$c) {
                continue;
            }
            app()->instance('current_tenant_id', $c->tenant_id);
            app()->instance('current_tenant_ref', $c->etablissement_uuid);
            try {
                $this->synchroniser($c);   // a-t-il payé entre-temps ?
            } catch (\Throwable) {
                // Paiements injoignable : on n'expire pas à l'aveugle, on réessaiera.
                continue;
            }
            if ($c->statut !== 'en_attente_paiement') {
                continue;
            }
            DB::transaction(function () use ($id, &$n) {
                $x = Candidature::withoutGlobalScopes()->where('id', $id)->lockForUpdate()->first();
                if (!$x || $x->statut !== 'en_attente_paiement') {
                    return;
                }
                $x->forceFill(['statut' => 'expiree', 'statut_paiement' => 'expire'])->save();
                $appel = AppelCandidature::withoutGlobalScopes()->where('uuid', $x->appel_uuid)->lockForUpdate()->first();
                if ($appel && $appel->places_disponibles !== null) {
                    $appel->increment('places_disponibles');
                }
                AuditService::journaliser('CANDIDATURE_EXPIREE', "Paiement non réglé à temps : {$x->reference}", ['candidature_uuid' => $x->uuid]);
                $n++;
            });
        }

        return $n;
    }

    // ───────────────────────────── internes ─────────────────────────────

    private function exigerEnAttente(Candidature $c): void
    {
        if ($c->statut_paiement === null) {
            throw new CandidatureException("Cette candidature ne nécessite aucun paiement.", 'PAIEMENT_NON_REQUIS', 409);
        }
        if ($c->statut === 'soumise' || $c->statut_paiement === 'paye') {
            throw new CandidatureException('Le paiement de cette candidature est déjà confirmé.', 'DEJA_PAYE', 409);
        }
        if ($c->statut === 'expiree' || ($c->paiement_expire_le && $c->paiement_expire_le->isPast())) {
            throw new CandidatureException('Le délai de paiement est dépassé. Veuillez déposer une nouvelle candidature.', 'PAIEMENT_EXPIRE', 410);
        }
        if ($c->statut !== 'en_attente_paiement') {
            throw new CandidatureException('Cette candidature ne peut plus être réglée.', 'PAIEMENT_IMPOSSIBLE', 409);
        }
    }

    private function etablissement(Candidature $c): string
    {
        if (empty($c->etablissement_uuid)) {
            throw new CandidatureException('Établissement du dossier introuvable.', 'TENANT_INVALIDE', 500);
        }

        return (string) $c->etablissement_uuid;
    }

    private function montantEntier(Candidature $c): int
    {
        $m = (float) $c->montant_du;
        if ($m <= 0 || $m != floor($m)) {
            throw new CandidatureException('Montant de candidature invalide.', 'MONTANT_INVALIDE', 500);
        }

        return (int) $m;
    }

    /** Pas de redirection ouverte : l'adresse de retour doit appartenir aux origines de la plateforme. */
    private function urlRetourAutorisee(?string $url): string
    {
        $p = $url ? parse_url($url) : false;
        if (!$p || !isset($p['scheme'], $p['host']) || !in_array($p['scheme'], ['http', 'https'], true)) {
            throw new CandidatureException("L'adresse de retour est invalide.", 'URL_RETOUR_INVALIDE', 422);
        }
        $origine = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
        $autorisees = array_map(fn($o) => rtrim($o, '/'), (array) config('inscription.origines_retour'));
        foreach ($autorisees as $a) {
            $motif = '#^' . str_replace('\*', '[a-z0-9-]+', preg_quote($a, '#')) . '$#i';
            if (preg_match($motif, $origine)) {
                return $url;
            }
        }
        throw new CandidatureException("L'adresse de retour n'est pas autorisée.", 'URL_RETOUR_NON_AUTORISEE', 422);
    }
}
