<?php

namespace App\candidatures;

use App\common\Traits\HasTenant;
use App\common\Traits\HasUuid;
use App\pieces_justificatives\PieceJustificative;
use App\tests_admission\TestAdmission;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Candidature extends Model
{
    use HasTenant, HasUuid;

    protected $table = 'inscription.candidatures';

    protected $fillable = [
        'uuid',
        'tenant_id',
        'appel_uuid',       // lien vers l'appel à candidature
        'nom',
        'prenom',
        'date_naissance',
        'sexe',
        'email',
        'telephone',
        'adresse',
        'type_inscription',
        'niveau_precedent',
        'etablissement_precedent',
        'classe_visee_id',  // nullable - résolu par le backend après admission
        'statut',
        'date_soumission',
        'motif_rejet',
        'parent_nom',
        'parent_prenom',
        'parent_telephone',
        'parent_email',
        'parent_lien',
        'reference',
        'etablissement_uuid',
        'donnees_complementaires',
        'statut_paiement',
        'montant_du',
        'devise_paiement',
        'paiement_expire_le',
        'empreinte_doublon',
        'traite_par_uuid',
        'date_traitement',
        'lot_uuid',
    ];

    protected $casts = [
        'tenant_id' => 'integer',
        'classe_visee_id' => 'integer',
        'date_naissance' => 'date',
        'date_soumission' => 'datetime',
        'donnees_complementaires' => 'array',
        'montant_du' => 'decimal:2',
        'paiement_expire_le' => 'datetime',
        'date_traitement' => 'datetime',
    ];

    public function piecesJustificatives(): HasMany
    {
        return $this->hasMany(PieceJustificative::class, 'candidature_id');
    }

    public function testsAdmission(): HasMany
    {
        return $this->hasMany(TestAdmission::class, 'candidature_id');
    }
}
