<?php

namespace App\common\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Vérification serveur du captcha (reCAPTCHA Enterprise, ou reCAPTCHA standard en repli).
 * ÉCHEC FERMÉ : en production, un captcha non configuré, injoignable ou jugé suspect refuse la requête.
 */
class CaptchaVerifier
{
    public function verifier(?string $jeton, ?string $ip = null): bool
    {
        $cfg = (array) config('inscription.captcha');

        if (($cfg['fournisseur'] ?? 'recaptcha') === 'none') {
            return !app()->environment('production');
        }
        if (empty($jeton)) {
            return false;
        }

        try {
            if (!empty($cfg['projet_id']) && !empty($cfg['cle_api']) && !empty($cfg['cle_site'])) {
                return $this->enterprise($jeton, $ip, $cfg);
            }
            if (!empty($cfg['cle_secrete'])) {
                return $this->standard($jeton, $ip, $cfg);
            }
        } catch (\Throwable $e) {
            Log::warning('[CAPTCHA] Vérification impossible : ' . $e->getMessage());

            return false;
        }

        Log::error('[CAPTCHA] Aucun fournisseur configuré.');

        return !app()->environment('production');
    }

    private function enterprise(string $jeton, ?string $ip, array $cfg): bool
    {
        $r = Http::timeout(5)->acceptJson()->post(
            'https://recaptchaenterprise.googleapis.com/v1/projects/' . rawurlencode((string) $cfg['projet_id'])
            . '/assessments?key=' . rawurlencode((string) $cfg['cle_api']),
            ['event' => array_filter(['token' => $jeton, 'siteKey' => $cfg['cle_site'], 'userIpAddress' => $ip, 'expectedAction' => $cfg['action'] ?: null])]
        );
        if (!$r->successful()) {
            return false;
        }
        if (!($r->json('tokenProperties.valid') === true)) {
            return false;
        }
        if (!empty($cfg['action']) && $r->json('tokenProperties.action') !== $cfg['action']) {
            return false;
        }

        return (float) $r->json('riskAnalysis.score', 0) >= (float) $cfg['score_min'];
    }

    private function standard(string $jeton, ?string $ip, array $cfg): bool
    {
        $r = Http::asForm()->timeout(5)->post('https://www.google.com/recaptcha/api/siteverify', array_filter([
            'secret' => $cfg['cle_secrete'], 'response' => $jeton, 'remoteip' => $ip,
        ]));
        if (!$r->successful() || $r->json('success') !== true) {
            return false;
        }

        return $r->json('score') === null || (float) $r->json('score') >= (float) $cfg['score_min'];
    }
}
