/**
 * Backfill default-checking cash accounts for every entity in every base
 * scenario. Each created account is named `<Entity Name> — Cash` and is
 * linked to the entity via an account_owners row at percent=1.0000.
 *
 * Phase 1 of the Entity Flows tab introduces per-entity income/expense
 * rows that need a deposit/withdrawal target. The entity-creation flow
 * provisions this account going forward, but pre-Phase-1 entities may
 * lack one — this script bridges the gap.
 *
 * Idempotent: re-runs are no-ops once every entity has a default checking.
 *
 * Run with: npx tsx scripts/backfill-entity-cash-accounts.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local without a runtime dep. Shell-sourcing breaks on `&` in the
// Neon URL, so scripts read it directly. Must run before `../src/db` is
// evaluated (which constructs a Pool from process.env.DATABASE_URL at module
// load) — so the db import is dynamic, inside main().
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local absent — fall through to the env-var check below.
}

/**
 * Backfill default-checking cash accounts.
 *
 * @param opts.clientId  Optional. When provided, only entities belonging to
 *   this client are processed. Used by the test suite to scope side effects
 *   to seeded data; production runs leave it unset to process every client.
 * @returns Number of accounts created (0 on a fully-backfilled DB).
 */
export async function backfillEntityCashAccounts(
  opts: { clientId?: string } = {},
): Promise<number> {
  const { db } = await import("../src/db");
  const { entities, scenarios, accounts, accountOwners } = await import(
    "../src/db/schema"
  );
  const { and, eq } = await import("drizzle-orm");

  const allEntities = await (opts.clientId
    ? db.select().from(entities).where(eq(entities.clientId, opts.clientId))
    : db.select().from(entities));
  const baseScenariosQuery = db
    .select({ id: scenarios.id, clientId: scenarios.clientId })
    .from(scenarios);
  const baseScenarios = await (opts.clientId
    ? baseScenariosQuery.where(
        and(eq(scenarios.isBaseCase, true), eq(scenarios.clientId, opts.clientId)),
      )
    : baseScenariosQuery.where(eq(scenarios.isBaseCase, true)));

  let created = 0;
  for (const ent of allEntities) {
    const scens = baseScenarios.filter((s) => s.clientId === ent.clientId);
    for (const s of scens) {
      // Find existing default-checking accounts owned by this entity in this scenario.
      const owned = await db
        .select({ id: accounts.id })
        .from(accounts)
        .innerJoin(accountOwners, eq(accountOwners.accountId, accounts.id))
        .where(
          and(
            eq(accounts.scenarioId, s.id),
            eq(accountOwners.entityId, ent.id),
            eq(accounts.isDefaultChecking, true),
          ),
        );
      if (owned.length > 0) continue;

      // Create cash account + entity-owner link in a single transaction so we
      // never leave an orphaned default-checking row if the owner insert fails
      // (the default-checking trigger requires exactly one entity owner).
      await db.transaction(async (tx) => {
        const [a] = await tx
          .insert(accounts)
          .values({
            clientId: ent.clientId,
            scenarioId: s.id,
            name: `${ent.name} — Cash`,
            category: "cash",
            subType: "checking",
            value: "0",
            basis: "0",
            growthRate: null,
            rmdEnabled: false,
            isDefaultChecking: true,
          })
          .returning({ id: accounts.id });

        await tx.insert(accountOwners).values({
          accountId: a.id,
          entityId: ent.id,
          familyMemberId: null,
          percent: "1.0000",
        });
      });

      created++;
      console.log(
        `  + created cash account for entity ${ent.id} (${ent.name}) in scenario ${s.id}`,
      );
    }
  }
  console.log(`Backfill complete. Created ${created} cash accounts.`);
  return created;
}

// Only auto-run when invoked directly (`tsx scripts/backfill-...ts`). When the
// test suite imports this module the entry-point check is false, so the
// function is exported but doesn't fire — the test invokes it explicitly.
// `tsx` runs `.ts` files as ESM, so `import.meta.url` is the resolved
// `file://` URL of this module; comparing it to argv[1] (which `tsx` passes
// as an absolute filesystem path) tells us whether we're the entry script.
const argvUrl = process.argv[1] ? `file://${process.argv[1]}` : "";
if (import.meta.url === argvUrl) {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Run from the repo root with .env.local present.",
    );
    process.exit(1);
  }
  backfillEntityCashAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
