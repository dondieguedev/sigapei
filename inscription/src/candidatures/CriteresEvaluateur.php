<?php

namespace App\candidatures;

use App\appels_candidatures\AppelCandidature;
use App\pieces_justificatives\PieceUploadService;
use Carbon\Carbon;
use Illuminate\Support\Str;

/**
 * Source unique de vérité des exigences d'un appel à candidature.
 *
 *  - schema()  : ce que voit le candidat (critères lisibles, pièces, frais, dates, étapes du formulaire) ;
 *  - valider() : ce que le serveur exige à la soumission, avec une erreur par champ.
 *
 * Le front génère ses étapes depuis schema() et n'embarque aucune règle propre.
 */
class CriteresEvaluateur
{
    /** @return array<int,array<string,mixed>> critères normalisés, avec un identifiant stable c0, c1… */
    public static function criteres(AppelCandidature $appel): array
    {
        $sortie = [];
        foreach (array_values((array) ($appel->criteres_eligibilite ?? [])) as $i => $c) {
            if (!is_array($c) || empty($c['type'])) {
                continue;
            }
            $type = (string) $c['type'];
            $n = [
                'id'          => 'c' . $i,
                'type'        => $type,
                'label'       => (string) ($c['label'] ?? self::libelleParDefaut($type)),
                'obligatoire' => !array_key_exists('obligatoire', $c) || filter_var($c['obligatoire'], FILTER_VALIDATE_BOOLEAN),
            ];
            if ($type === 'age') {
                $n['date_min'] = self::date($c['date_min'] ?? $c['date_naissance_min'] ?? null)?->toDateString();
                $n['date_max'] = self::date($c['date_max'] ?? $c['date_naissance_max'] ?? null)?->toDateString();
            } elseif ($type === 'type_inscription') {
                $n['mode'] = (string) ($c['mode'] ?? $c['valeur'] ?? '');
                $n['matieres_composees'] = array_values((array) ($c['matieres_composees'] ?? []));
            } elseif ($type === 'texte') {
                $n['texte'] = (string) ($c['valeur_texte'] ?? $c['valeur'] ?? $n['label']);
            } elseif ($type === 'niveau_scolaire') {
                $n['niveaux_acceptes'] = array_values(array_filter((array) ($c['niveaux_acceptes'] ?? [])));
            }
            $sortie[] = $n;
        }

        return $sortie;
    }

    /** @return array<int,array<string,mixed>> pièces normalisées avec identifiant stable p0, p1… */
    public static function pieces(AppelCandidature $appel): array
    {
        $sortie = [];
        foreach (array_values((array) ($appel->pieces_fournir ?? [])) as $i => $p) {
            if (!is_array($p)) {
                continue;
            }
            $libelle = trim((string) ($p['libelle'] ?? $p['nom'] ?? ''));
            if ($libelle === '') {
                continue;
            }
            $formats = PieceUploadService::formatsAutorises($p['format'] ?? $p['formats'] ?? null);
            $sortie[] = [
                'id'             => 'p' . $i,
                'libelle'        => $libelle,
                'formats'        => array_map('strtoupper', $formats),
                'obligatoire'    => !array_key_exists('obligatoire', $p) || filter_var($p['obligatoire'], FILTER_VALIDATE_BOOLEAN),
                'taille_max_octets' => PieceUploadService::tailleMax(),
            ];
        }

        return $sortie;
    }

    public static function devise(AppelCandidature $appel): string
    {
        $d = strtoupper(trim((string) ($appel->devise ?? 'XOF')));

        return in_array($d, ['FCFA', 'CFA', 'F CFA'], true) || $d === '' ? 'XOF' : $d;
    }

    public static function paiementRequis(AppelCandidature $appel): bool
    {
        return (bool) $appel->est_payant && (float) $appel->montant > 0;
    }

    /** Schéma complet publié avec l'appel. */
    public static function schema(AppelCandidature $appel): array
    {
        $criteres = self::criteres($appel);
        $pieces = self::pieces($appel);
        $paiement = self::paiementRequis($appel);

        $champsIdentite = [
            ['nom' => 'nom', 'label' => 'Nom', 'type' => 'texte', 'obligatoire' => true, 'max' => 100],
            ['nom' => 'prenom', 'label' => 'Prénoms', 'type' => 'texte', 'obligatoire' => true, 'max' => 100],
            ['nom' => 'date_naissance', 'label' => 'Date de naissance', 'type' => 'date', 'obligatoire' => true],
            ['nom' => 'sexe', 'label' => 'Sexe', 'type' => 'choix', 'obligatoire' => false, 'options' => [['valeur' => 'M', 'label' => 'Masculin'], ['valeur' => 'F', 'label' => 'Féminin']]],
        ];
        $champsCriteres = [];
        $contactRequis = $paiement;
        foreach ($criteres as $c) {
            switch ($c['type']) {
                case 'age':
                    foreach ($champsIdentite as &$champ) {
                        if ($champ['nom'] === 'date_naissance') {
                            $champ['min'] = $c['date_min'] ?? null;
                            $champ['max'] = $c['date_max'] ?? null;
                        }
                    }
                    unset($champ);
                    break;
                case 'contact':
                    $contactRequis = $contactRequis || $c['obligatoire'];
                    break;
                case 'niveau_scolaire':
                    $champsCriteres[] = ['nom' => 'niveau_precedent', 'label' => 'Niveau scolaire précédent', 'type' => $c['niveaux_acceptes'] ? 'choix' : 'texte', 'obligatoire' => $c['obligatoire'], 'max' => 150, 'options' => array_map(fn($v) => ['valeur' => $v, 'label' => $v], $c['niveaux_acceptes'])];
                    $champsCriteres[] = ['nom' => 'etablissement_precedent', 'label' => 'Établissement précédent', 'type' => 'texte', 'obligatoire' => false, 'max' => 150];
                    break;
                case 'adresse':
                    $champsCriteres[] = ['nom' => 'adresse', 'label' => 'Adresse', 'type' => 'texte', 'obligatoire' => $c['obligatoire'], 'max' => 255];
                    break;
                case 'parent_tuteur':
                    $o = $c['obligatoire'];
                    $champsCriteres[] = ['nom' => 'parent_nom', 'label' => 'Nom du parent / tuteur', 'type' => 'texte', 'obligatoire' => $o, 'max' => 100];
                    $champsCriteres[] = ['nom' => 'parent_prenom', 'label' => 'Prénoms du parent / tuteur', 'type' => 'texte', 'obligatoire' => false, 'max' => 100];
                    $champsCriteres[] = ['nom' => 'parent_telephone', 'label' => 'Téléphone du parent / tuteur', 'type' => 'telephone', 'obligatoire' => $o, 'max' => 50];
                    $champsCriteres[] = ['nom' => 'parent_email', 'label' => 'E-mail du parent / tuteur', 'type' => 'email', 'obligatoire' => false, 'max' => 150];
                    $champsCriteres[] = ['nom' => 'parent_lien', 'label' => 'Lien de parenté', 'type' => 'choix', 'obligatoire' => false, 'options' => [['valeur' => 'pere', 'label' => 'Père'], ['valeur' => 'mere', 'label' => 'Mère'], ['valeur' => 'tuteur', 'label' => 'Tuteur / tutrice']]];
                    break;
                case 'texte':
                    $champsCriteres[] = ['nom' => 'attestations.' . $c['id'], 'label' => $c['texte'], 'type' => 'attestation', 'obligatoire' => $c['obligatoire']];
                    break;
            }
        }

        $champsContact = [
            ['nom' => 'email', 'label' => 'Adresse e-mail', 'type' => 'email', 'obligatoire' => false, 'max' => 150],
            ['nom' => 'telephone', 'label' => 'Téléphone', 'type' => 'telephone', 'obligatoire' => false, 'max' => 50],
        ];

        $etapes = [
            ['id' => 'identite', 'titre' => 'Informations personnelles', 'champs' => array_merge($champsIdentite, $champsContact, array_values(array_filter($champsCriteres, fn($c) => in_array($c['nom'], ['adresse'], true))))],
        ];
        $autres = array_values(array_filter($champsCriteres, fn($c) => $c['nom'] !== 'adresse'));
        if ($autres) {
            $etapes[] = ['id' => 'criteres', 'titre' => 'Parcours et conditions', 'champs' => $autres];
        }
        if ($pieces) {
            $etapes[] = ['id' => 'documents', 'titre' => 'Pièces justificatives', 'pieces' => $pieces];
        }
        if ($paiement) {
            $etapes[] = ['id' => 'paiement', 'titre' => 'Frais de candidature'];
        }
        $etapes[] = ['id' => 'recapitulatif', 'titre' => 'Récapitulatif'];

        return [
            'etapes'   => $etapes,
            'criteres' => array_map(fn($c) => $c + ['description' => self::decrire($c)], $criteres),
            'pieces'   => $pieces,
            'contact_requis' => $contactRequis,
            'paiement' => [
                'requis'  => $paiement,
                'montant' => $paiement ? (float) $appel->montant : 0,
                'devise'  => self::devise($appel),
            ],
            'dates' => [
                'debut' => $appel->date_debut?->toIso8601String(),
                'fin'   => $appel->date_fin?->toIso8601String(),
            ],
            'places_disponibles' => $appel->places_disponibles,
        ];
    }

    /**
     * Contrôle serveur d'un dossier.
     *
     * @param  array<string,mixed> $d        champs reçus
     * @param  array<string,mixed> $fichiers fichiers reçus, indexés par identifiant de pièce
     * @return array<string,string> erreurs par champ (vide = dossier recevable)
     */
    public static function valider(AppelCandidature $appel, array $d, array $fichiers): array
    {
        $e = [];
        $vide = fn($k) => !isset($d[$k]) || trim((string) $d[$k]) === '';

        foreach (['nom' => 'Le nom', 'prenom' => 'Le prénom'] as $k => $l) {
            if ($vide($k)) {
                $e[$k] = "{$l} est obligatoire.";
            }
        }

        $naissance = null;
        if ($vide('date_naissance')) {
            $e['date_naissance'] = 'La date de naissance est obligatoire.';
        } else {
            $naissance = self::date($d['date_naissance']);
            if (!$naissance) {
                $e['date_naissance'] = 'La date de naissance est invalide.';
            } elseif ($naissance->isFuture()) {
                $e['date_naissance'] = 'La date de naissance ne peut pas être dans le futur.';
            }
        }

        $contactRequis = self::paiementRequis($appel);
        foreach (self::criteres($appel) as $c) {
            $o = $c['obligatoire'];
            switch ($c['type']) {
                case 'age':
                    if ($naissance && !isset($e['date_naissance'])) {
                        // Bornes INCLUSIVES, comparées au jour près.
                        $n = $naissance->copy()->startOfDay();
                        if (!empty($c['date_min']) && $n->lt(Carbon::parse($c['date_min'])->startOfDay())) {
                            $e['date_naissance'] = 'Critère d\'âge non respecté : vous devez être né(e) à partir du ' . self::fr($c['date_min']) . ' (inclus).';
                        } elseif (!empty($c['date_max']) && $n->gt(Carbon::parse($c['date_max'])->startOfDay())) {
                            $e['date_naissance'] = 'Critère d\'âge non respecté : vous devez être né(e) au plus tard le ' . self::fr($c['date_max']) . ' (inclus).';
                        }
                    }
                    break;
                case 'contact':
                    $contactRequis = $contactRequis || $o;
                    break;
                case 'niveau_scolaire':
                    if ($vide('niveau_precedent')) {
                        if ($o) {
                            $e['niveau_precedent'] = 'Le niveau scolaire précédent est obligatoire.';
                        }
                    } elseif ($c['niveaux_acceptes'] && !in_array($d['niveau_precedent'], $c['niveaux_acceptes'], true)) {
                        $e['niveau_precedent'] = 'Ce niveau n\'est pas accepté pour cet appel. Niveaux acceptés : ' . implode(', ', $c['niveaux_acceptes']) . '.';
                    }
                    break;
                case 'adresse':
                    if ($o && $vide('adresse')) {
                        $e['adresse'] = 'L\'adresse est obligatoire.';
                    }
                    break;
                case 'parent_tuteur':
                    if ($o) {
                        foreach (['parent_nom' => 'Le nom du parent ou tuteur', 'parent_telephone' => 'Le téléphone du parent ou tuteur'] as $k => $l) {
                            if ($vide($k)) {
                                $e[$k] = "{$l} est obligatoire.";
                            }
                        }
                    }
                    break;
                case 'texte':
                    $att = $d['attestations'][$c['id']] ?? null;
                    if ($o && !filter_var($att, FILTER_VALIDATE_BOOLEAN)) {
                        $e['attestations.' . $c['id']] = 'Vous devez confirmer cette condition : ' . $c['texte'];
                    }
                    break;
            }
        }

        if ($contactRequis && $vide('email') && $vide('telephone') && $vide('parent_email') && $vide('parent_telephone')) {
            $e['telephone'] = 'Un numéro de téléphone ou une adresse e-mail est requis.';
        }

        foreach (self::pieces($appel) as $p) {
            $f = $fichiers[$p['id']] ?? null;
            if ($f === null) {
                if ($p['obligatoire']) {
                    $e['fichiers.' . $p['id']] = "La pièce « {$p['libelle']} » est obligatoire.";
                }
                continue;
            }
            if ($msg = PieceUploadService::erreur($f, array_map('strtolower', $p['formats']))) {
                $e['fichiers.' . $p['id']] = $msg;
            }
        }

        return $e;
    }

    /** Phrase lisible décrivant un critère pour le candidat. */
    public static function decrire(array $c): string
    {
        return match ($c['type']) {
            'age' => match (true) {
                !empty($c['date_min']) && !empty($c['date_max']) => 'Être né(e) entre le ' . self::fr($c['date_min']) . ' et le ' . self::fr($c['date_max']) . ' (dates incluses).',
                !empty($c['date_min']) => 'Être né(e) à partir du ' . self::fr($c['date_min']) . ' (inclus).',
                !empty($c['date_max']) => 'Être né(e) au plus tard le ' . self::fr($c['date_max']) . ' (inclus).',
                default => 'Aucune limite d\'âge.',
            },
            'type_inscription' => 'Modalité d\'admission : ' . match ($c['mode'] ?? '') {
                'concours' => 'concours',
                'test' => 'test d\'admission',
                'libre' => 'inscription libre',
                'selection' => 'sélection sur dossier',
                default => ($c['mode'] ?: 'à définir par l\'établissement'),
            } . (!empty($c['matieres_composees']) ? ' (matières : ' . implode(', ', $c['matieres_composees']) . ')' : '') . '.',
            'texte' => $c['texte'] ?? $c['label'],
            'contact' => 'Fournir un numéro de téléphone ou une adresse e-mail.',
            'niveau_scolaire' => 'Indiquer le niveau scolaire précédent' . ($c['niveaux_acceptes'] ? ' (acceptés : ' . implode(', ', $c['niveaux_acceptes']) . ')' : '') . '.',
            'adresse' => 'Renseigner l\'adresse du candidat.',
            'parent_tuteur' => 'Renseigner le parent ou tuteur (nom et téléphone).',
            default => $c['label'],
        };
    }

    private static function libelleParDefaut(string $type): string
    {
        return match ($type) {
            'age' => 'Âge / date de naissance',
            'type_inscription' => 'Modalité d\'admission',
            'contact' => 'Contact',
            'niveau_scolaire' => 'Niveau scolaire précédent',
            'adresse' => 'Adresse',
            'parent_tuteur' => 'Parent / tuteur',
            default => Str::headline($type),
        };
    }

    private static function date(mixed $v): ?Carbon
    {
        if ($v === null || $v === '') {
            return null;
        }
        try {
            return Carbon::parse((string) $v);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function fr(string $date): string
    {
        return Carbon::parse($date)->locale('fr')->translatedFormat('d F Y');
    }
}
