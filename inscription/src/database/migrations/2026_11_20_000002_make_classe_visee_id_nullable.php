<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rend classe_visee_id nullable dans inscription.candidatures.
 * Cette colonne est renseignée automatiquement depuis l'appel lors de la soumission,
 * mais elle ne doit pas bloquer une candidature sans appel configuré avec une classe.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ALTER COLUMN direct - plus fiable que Schema::table pour changer nullable sur Neon
        DB::statement('ALTER TABLE inscription.candidatures ALTER COLUMN classe_visee_id DROP NOT NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE inscription.candidatures ALTER COLUMN classe_visee_id SET NOT NULL');
    }
};
