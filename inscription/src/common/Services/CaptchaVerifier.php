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
            Log::warning('[CAPTCHA] Refus : jeton absent (le navigateur n\'a pas fourni de jeton).');

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
            Log::warning('[CAPTCHA] Enterprise : HTTP ' . $r->status() . ' ' . $r->json('error.status') . ' - ' . $r->json('error.message'));

            return false;
        }
        if (!($r->json('tokenProperties.valid') === true)) {
            Log::warning('[CAPTCHA] Enterprise : jeton invalide, raison=' . $r->json('tokenProperties.invalidReason'));

            return false;
        }
        if (!empty($cfg['action']) && $r->json('tokenProperties.action') !== $cfg['action']) {
            Log::warning('[CAPTCHA] Enterprise : action reçue=' . $r->json('tokenProperties.action') . ' attendue=' . $cfg['action']);

            return false;
        }
        $score = (float) $r->json('riskAnalysis.score', 0);
        if ($score < (float) $cfg['score_min']) {
            Log::warning('[CAPTCHA] Enterprise : score ' . $score . ' < minimum ' . $cfg['score_min']);

            return false;
        }

        return true;
    }

    private function standard(string $jeton, ?string $ip, array $cfg): bool
    {
        $r = Http::asForm()->timeout(5)->post('https://www.google.com/recaptcha/api/siteverify', array_filter([
            'secret' => $cfg['cle_secrete'], 'response' => $jeton, 'remoteip' => $ip,
        ]));
        if (!$r->successful() || $r->json('success') !== true) {
            Log::warning('[CAPTCHA] Standard : refus, erreurs=' . json_encode($r->json('error-codes')));

            return false;
        }
        if ($r->json('score') !== null && (float) $r->json('score') < (float) $cfg['score_min']) {
            Log::warning('[CAPTCHA] Standard : score ' . $r->json('score') . ' < minimum ' . $cfg['score_min']);

            return false;
        }

        return true;
    }
}