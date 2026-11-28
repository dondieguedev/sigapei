<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Durcissement du flux de candidature :
 *  - numéro de suivi public (reference) et réponses aux critères libres ;
 *  - date de naissance nullable (la validation applicative reste la règle) ;
 *  - suivi du paiement, du traitement (qui/quand/lot) ;
 *  - anti-doublon par appel ;
 *  - métadonnées d'intégrité des pièces ;
 *  - statut d'appel « ferme » fusionné dans « termine ».
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inscription.candidatures', function (Blueprint $table) {
            $table->string('reference', 24)->nullable()->unique();
            $table->uuid('etablissement_uuid')->nullable();  // nécessaire aux échanges avec le service Paiements
            $table->jsonb('donnees_complementaires')->nullable();
            $table->string('statut_paiement', 20)->nullable();      // en_attente | paye | a_rembourser
            $table->decimal('montant_du', 12, 2)->nullable();
            $table->string('devise_paiement', 10)->nullable();
            $table->timestamp('paiement_expire_le')->nullable();
            $table->uuid('traite_par_uuid')->nullable();
            $table->timestamp('date_traitement')->nullable();
            $table->uuid('lot_uuid')->nullable()->index();
            $table->char('empreinte_doublon', 64)->nullable();
        });

        DB::statement('ALTER TABLE inscription.candidatures ALTER COLUMN date_naissance DROP NOT NULL');

        // Un même candidat (nom, prénom, date de naissance) ne peut déposer qu'un dossier actif par appel.
        DB::statement(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_candidature_doublon
               ON inscription.candidatures (tenant_id, appel_uuid, empreinte_doublon)
             WHERE empreinte_doublon IS NOT NULL AND statut NOT IN ('rejetee','expiree')"
        );

        // Un dossier ne peut être que dans un statut connu.
        DB::statement(
            "ALTER TABLE inscription.candidatures DROP CONSTRAINT IF EXISTS ck_candidature_statut"
        );
        DB::statement(
            "ALTER TABLE inscription.candidatures ADD CONSTRAINT ck_candidature_statut
               CHECK (statut IN ('en_attente_paiement','soumise','en_attente','validee','rejetee','expiree')) NOT VALID"
        );

        // Un rejet porte toujours son motif.
        DB::statement(
            "ALTER TABLE inscription.candidatures DROP CONSTRAINT IF EXISTS ck_candidature_rejet_motif"
        );
        DB::statement(
            "ALTER TABLE inscription.candidatures ADD CONSTRAINT ck_candidature_rejet_motif
               CHECK (statut <> 'rejetee' OR (motif_rejet IS NOT NULL AND length(trim(motif_rejet)) > 0)) NOT VALID"
        );

        Schema::table('inscription.pieces_justificatives', function (Blueprint $table) {
            $table->string('piece_id', 32)->nullable();
            $table->string('libelle', 255)->nullable();
            $table->char('hash_sha256', 64)->nullable();
        });

        DB::statement("UPDATE inscription.appels_candidatures SET statut = 'termine' WHERE statut = 'ferme'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS inscription.uq_candidature_doublon');
        DB::statement('ALTER TABLE inscription.candidatures DROP CONSTRAINT IF EXISTS ck_candidature_statut');
        DB::statement('ALTER TABLE inscription.candidatures DROP CONSTRAINT IF EXISTS ck_candidature_rejet_motif');

        Schema::table('inscription.pieces_justificatives', function (Blueprint $table) {
            $table->dropColumn(['piece_id', 'libelle', 'hash_sha256']);
        });
        Schema::table('inscription.candidatures', function (Blueprint $table) {
            $table->dropColumn([
                'reference', 'etablissement_uuid', 'donnees_complementaires', 'statut_paiement', 'montant_du', 'devise_paiement',
                'paiement_expire_le', 'traite_par_uuid', 'date_traitement', 'lot_uuid', 'empreinte_doublon',
            ]);
        });
    }
};
