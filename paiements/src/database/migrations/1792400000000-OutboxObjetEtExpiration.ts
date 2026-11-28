import { MigrationInterface, QueryRunner } from 'typeorm';

/** Index pour retrouver un encaissement par objet métier et pour l'expiration des paiements non finalisés. */
export class OutboxObjetEtExpiration1792400000000 implements MigrationInterface {
  name = 'OutboxObjetEtExpiration1792400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX IF NOT EXISTS idx_encaissement_objet_statut ON "paiement"."encaissement" ("etablissement_uuid", "objet_type", "objet_uuid", "created_at" DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_encaissement_expiration ON "paiement"."encaissement" ("expire_le") WHERE "statut" IN ('initie','en_attente')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "paiement"."idx_encaissement_objet_statut"`);
    await q.query(`DROP INDEX IF EXISTS "paiement"."idx_encaissement_expiration"`);
  }
}
