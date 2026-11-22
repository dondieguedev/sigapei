<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ajoute les colonnes manquantes :
 *  - inscription.candidatures   : appel_uuid, type_inscription, niveau_precedent, etablissement_precedent
 *  - inscription.appels_candidatures : classe_visee_id, classe_uuid
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Table candidatures ──────────────────────────────────────────
        Schema::table('inscription.candidatures', function (Blueprint $table) {
            if (!Schema::hasColumn('inscription.candidatures', 'appel_uuid')) {
                $table->uuid('appel_uuid')->nullable()->after('uuid');
            }
            if (!Schema::hasColumn('inscription.candidatures', 'type_inscription')) {
                $table->string('type_inscription', 50)->nullable()->after('adresse');
            }
            if (!Schema::hasColumn('inscription.candidatures', 'niveau_precedent')) {
                $table->string('niveau_precedent', 150)->nullable()->after('type_inscription');
            }
            if (!Schema::hasColumn('inscription.candidatures', 'etablissement_precedent')) {
                $table->string('etablissement_precedent', 150)->nullable()->after('niveau_precedent');
            }
        });

        // ── Table appels_candidatures ───────────────────────────────────
        Schema::table('inscription.appels_candidatures', function (Blueprint $table) {
            if (!Schema::hasColumn('inscription.appels_candidatures', 'classe_visee_id')) {
                $table->unsignedBigInteger('classe_visee_id')->nullable()->after('places_disponibles');
            }
            if (!Schema::hasColumn('inscription.appels_candidatures', 'classe_uuid')) {
                $table->uuid('classe_uuid')->nullable()->after('classe_visee_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('inscription.candidatures', function (Blueprint $table) {
            $table->dropColumn(['appel_uuid', 'type_inscription', 'niveau_precedent', 'etablissement_precedent']);
        });

        Schema::table('inscription.appels_candidatures', function (Blueprint $table) {
            $table->dropColumn(['classe_visee_id', 'classe_uuid']);
        });
    }
};
