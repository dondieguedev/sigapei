<?php

namespace App\pieces_justificatives;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Réception sécurisée des pièces d'une candidature.
 *  - le format accepté vient de l'appel (pièce demandée), jamais du client ;
 *  - le type réel est lu sur le contenu (finfo), pas sur l'extension ou l'en-tête Content-Type ;
 *  - extension et contenu doivent concorder ; les doubles extensions exécutables sont refusées ;
 *  - le chemin de stockage est entièrement construit par le serveur et préfixé par l'établissement.
 */
class PieceUploadService
{
    /** format canonique => types MIME réels acceptés */
    private const FORMATS = [
        'pdf' => ['application/pdf'],
        'jpg' => ['image/jpeg'],
        'png' => ['image/png'],
    ];

    private const DEFAUT = ['pdf', 'jpg', 'png'];

    /** Extensions qui ne doivent jamais apparaître dans un nom de fichier déposé. */
    private const INTERDITES = '/\.(php\d?|phtml|phar|exe|dll|js|mjs|html?|svg|sh|bat|cmd|jar|msi|com|scr)(\.|$)/i';

    /** Convertit « PDF », « JPEG, PNG », « PDF / JPG » en liste canonique. */
    public static function formatsAutorises(?string $format): array
    {
        $trouves = [];
        foreach (preg_split('/[\s,;\/|]+/', strtolower((string) $format), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $jeton) {
            $jeton = ltrim($jeton, '.');
            $jeton = $jeton === 'jpeg' ? 'jpg' : $jeton;
            if (isset(self::FORMATS[$jeton])) {
                $trouves[$jeton] = true;
            }
        }

        return $trouves ? array_keys($trouves) : self::DEFAUT;
    }

    public static function tailleMax(): int
    {
        return max(1, (int) config('inscription.piece_max_octets', 5 * 1024 * 1024));
    }

    /** @return string|null message d'erreur lisible, ou null si le fichier est conforme */
    public static function erreur(mixed $fichier, array $formats): ?string
    {
        if (!$fichier instanceof UploadedFile || !$fichier->isValid()) {
            return "Le fichier n'a pas pu être reçu. Veuillez le téléverser à nouveau.";
        }

        $liste = strtoupper(implode(', ', $formats));
        $taille = (int) $fichier->getSize();
        if ($taille <= 0) {
            return 'Le fichier est vide.';
        }
        if ($taille > self::tailleMax()) {
            return 'Le fichier dépasse la taille maximale de ' . round(self::tailleMax() / 1048576, 1) . ' Mo.';
        }

        $nom = (string) $fichier->getClientOriginalName();
        if (preg_match(self::INTERDITES, $nom)) {
            return 'Ce nom de fichier n\'est pas autorisé.';
        }

        $ext = strtolower((string) pathinfo($nom, PATHINFO_EXTENSION));
        $ext = $ext === 'jpeg' ? 'jpg' : $ext;
        $mime = strtolower((string) $fichier->getMimeType());   // détection sur le contenu
        $formatReel = null;
        foreach (self::FORMATS as $fmt => $mimes) {
            if (in_array($mime, $mimes, true)) {
                $formatReel = $fmt;
                break;
            }
        }

        if ($formatReel === null || !in_array($formatReel, $formats, true)) {
            return "Format non accepté pour cette pièce. Formats autorisés : {$liste}.";
        }
        if ($ext !== $formatReel) {
            return "L'extension du fichier ne correspond pas à son contenu. Formats autorisés : {$liste}.";
        }

        if ($formatReel === 'pdf') {
            $debut = (string) @file_get_contents($fichier->getRealPath(), false, null, 0, self::tailleMax());
            if (preg_match('#/(JavaScript|Launch)\b#', $debut)) {
                return 'Ce document PDF contient du contenu actif non autorisé.';
            }
        }

        return null;
    }

    /**
     * Enregistre un fichier déjà validé.
     *
     * @return array{chemin:string, nom_original:string, taille:int, mime:string, hash:string}
     */
    public function stocker(UploadedFile $fichier, int|string $tenantId, string $candidatureUuid): array
    {
        $ext = strtolower((string) pathinfo((string) $fichier->getClientOriginalName(), PATHINFO_EXTENSION));
        $ext = $ext === 'jpeg' ? 'jpg' : $ext;
        $dossier = "tenants/{$tenantId}/candidatures/{$candidatureUuid}";
        $nom = Str::uuid()->toString() . '.' . $ext;

        $chemin = Storage::disk(config('inscription.disque_pieces'))
            ->putFileAs($dossier, $fichier, $nom, ['visibility' => 'private']);
        if (!$chemin) {
            throw new \RuntimeException("Écriture de la pièce impossible.");
        }

        $original = preg_replace('/[\x00-\x1F\x7F\/\\\\]+/', '', basename((string) $fichier->getClientOriginalName()));

        return [
            'chemin'       => $chemin,
            'nom_original' => mb_substr((string) $original, 0, 255),
            'taille'       => (int) $fichier->getSize(),
            'mime'         => (string) $fichier->getMimeType(),
            'hash'         => hash_file('sha256', $fichier->getRealPath()),
        ];
    }

    public function supprimer(string $chemin): void
    {
        try {
            Storage::disk(config('inscription.disque_pieces'))->delete($chemin);
        } catch (\Throwable) {
            // Nettoyage au mieux : l'échec ne doit pas masquer l'erreur d'origine.
        }
    }
}
