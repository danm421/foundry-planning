// Migration 0229 — living expenses become a closed two-bucket set.
//
// Per (client_id, scenario_id) that owns living rows, in this order:
//   1. ADOPT OR SEED. For each role (current/retirement), if no is_default
//      living row with that role exists, promote one orphan that already has
//      the role's canonical window — largest annual_amount, tie-broken on
//      oldest created_at — or insert a $0 canonical row when there is none.
//   2. RECLASSIFY. Every remaining non-default living row becomes `other`.
//      Name, amount, window and growth rate are preserved untouched.
//   3. NORMALISE. Force the canonical name on every surviving default row that
//      classifies to a role, and force growth_source='inflation' on EVERY
//      surviving default row — including correctly-named ones.
//
// Order is load-bearing: reversing 1 and 2 moves a client's real spending to
// Other and leaves them two $0 slots.
//
// FAIL-CLOSED MONEY GUARD. That ordering is necessary but NOT sufficient:
// adoption is gated on slot *presence*, so two $0 slots plus a funded orphan
// still empties the living bucket, and a legacy row with a NULL start_year_ref
// can never be adopted at all. Rather than guess how to reshape such a plan,
// this script computes every scenario's living-bucket delta BEFORE writing
// anything and aborts the whole run if any scenario would lose living money,
// printing a complete manifest. `type === "living"` drives the solver's
// spending lever, the life-insurance need calculation and the spending stress
// test, so a silent drop changes real advice.
//
// There is deliberately NO override flag. An "--i-know-what-im-doing" escape
// hatch is the thing that ends up pasted into a runbook, and it lets a run
// proceed without the decision ever being made. The guard clears itself: fund
// the canonical slots for the listed scenarios and it passes on the next run.
//
// Scope note: the loop is driven by the living rows that exist, NOT by the
// `scenarios` table. Non-base scenarios are OVERLAYS — `projection/
// load-client-data.ts` reads every entity row from the `is_base_case`
// scenario and layers `scenario_changes` on top — so a non-base scenario
// legitimately owns zero expense rows. Seeding into one would create rows no
// loader ever reads.
//
// Idempotent: re-running is a no-op once every scenario has its two slots.
//
// Run:  DATABASE_URL='<dsn>' npx tsx scripts/run-migration-0229-living-two-bucket.ts [--dry-run]
//
// NOTE: quote the DSN. An unquoted connection string loses its @host to shell
// expansion — see the perl-replacement-eats-at-sign hazard.
//
// ROLLBACK. Before its first write the script snapshots every expense row's
// mutable columns into `_m0229_rollback` (created once; a re-run keeps the
// original snapshot, since a second run's "before" is already migrated state).
// To undo a completed run:
//
//   UPDATE expenses e SET type = r.type::expense_type, name = r.name,
//          growth_source = r.growth_source::item_growth_source,
//          is_default = r.is_default
//     FROM _m0229_rollback r WHERE r.id = e.id;
//   DELETE FROM expenses
//    WHERE type = 'living' AND id NOT IN (SELECT id FROM _m0229_rollback);
//   DROP TABLE _m0229_rollback;
//
// The DELETE removes the $0 slots this migration seeded — they are exactly the
// living rows absent from the snapshot.
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { clients, crmHouseholdContacts, expenses, planSettings } from "@/db/schema";
import { birthYearFromDob } from "@/lib/age-year";
import type { LivingRole } from "@/lib/living-expenses";
import {
  CANONICAL_NAME,
  findLivingMoneyLoss,
  planLivingScenario,
  type LivingRowFacts,
  type LivingScenarioPlan,
} from "@/lib/living-expenses-migration";

const DRY_RUN = process.argv.includes("--dry-run");

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Milestone years a seeded slot is stamped with. Resolved in BOTH modes. */
interface SlotAnchors {
  planStartYear: number;
  retirementYear: number;
  planEndYear: number;
  hadDob: boolean;
}

async function main() {
  const rows = await db
    .select({
      id: expenses.id,
      clientId: expenses.clientId,
      scenarioId: expenses.scenarioId,
      name: expenses.name,
      annualAmount: expenses.annualAmount,
      startYearRef: expenses.startYearRef,
      endYearRef: expenses.endYearRef,
      growthSource: expenses.growthSource,
      isDefault: expenses.isDefault,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .where(eq(expenses.type, "living"));

  // Group by (clientId, scenarioId).
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.clientId}::${r.scenarioId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // ── Plan every scenario before touching anything ────────────────────────
  const planned: { clientId: string; scenarioId: string; plan: LivingScenarioPlan }[] = [];
  for (const [key, group] of groups) {
    const [clientId, scenarioId] = key.split("::");
    planned.push({
      clientId,
      scenarioId,
      plan: planLivingScenario(group as LivingRowFacts[]),
    });
  }

  // ── FAIL-CLOSED GUARD ───────────────────────────────────────────────────
  const losses = findLivingMoneyLoss(planned);
  if (losses.length > 0) {
    const totalLost = losses.reduce((n, l) => n + (l.livingCentsBefore - l.livingCentsAfter), 0);
    console.error(
      `\nABORTED — ${losses.length} scenario(s) would lose living-bucket money ` +
        `(${money(totalLost)} in total). NOTHING WAS WRITTEN.\n`,
    );
    console.error(
      "The two-bucket model has no sanctioned way for money to leave the living\n" +
        'bucket. `type === "living"` drives the solver\'s spending lever, the\n' +
        "life-insurance need calculation and the spending stress test, so moving\n" +
        "these rows to `other` would change real advice.\n\n" +
        "Each scenario below needs a decision. To clear it: move the spending these\n" +
        "rows represent into the scenario's canonical Current/Retirement slots, then\n" +
        "zero or delete the rows listed, and re-run. Funding the slots alone is not\n" +
        "enough — the guard fires on any funded row leaving the bucket. Listed in\n" +
        "full, no truncation.\n",
    );
    for (const l of losses) {
      console.error(
        `  scenario ${l.scenarioId}  (client ${l.clientId})\n` +
          `    living now: ${money(l.livingCentsBefore)}  →  after: ${money(l.livingCentsAfter)}`,
      );
      for (const r of l.leaving) {
        console.error(`      - ${r.id}  "${r.name}"  $${r.annualAmount}`);
      }
    }
    console.error("");
    process.exit(1);
  }

  const stats = {
    adopted: 0,
    seeded: 0,
    reclassified: 0,
    renamed: 0,
    growthSourceForced: 0,
    scenarios: planned.length,
    seededWithoutDob: 0,
  };

  let snapshotted = false;
  /** Take the rollback snapshot lazily — only once a run actually has writes. */
  const ensureRollbackSnapshot = async () => {
    if (snapshotted) return;
    snapshotted = true;
    const existing = await db.execute(
      sql`SELECT to_regclass('_m0229_rollback') IS NOT NULL AS existed`,
    );
    if ((existing.rows[0] as { existed: boolean }).existed) {
      console.log("[rollback] _m0229_rollback exists — keeping the original snapshot.");
      return;
    }
    await db.execute(sql`
      CREATE TABLE _m0229_rollback AS
      SELECT id, type::text AS type, name, growth_source::text AS growth_source, is_default
      FROM expenses
    `);
    console.log("[rollback] snapshot written to _m0229_rollback.");
  };

  for (const { clientId, scenarioId, plan } of planned) {
    for (const { row, role } of plan.adopt) {
      console.log(`[adopt] ${clientId} ${role}: ${row.id} "${row.name}" $${row.annualAmount}`);
      if (!DRY_RUN) {
        await ensureRollbackSnapshot();
        await db.update(expenses).set({ isDefault: true }).where(eq(expenses.id, row.id));
      }
      stats.adopted += 1;
    }

    for (const role of plan.seed) {
      // Resolved in BOTH modes: a dry run that skipped this could not report
      // the DOB gap it is being used to pre-flight.
      const anchors = await resolveSlotAnchors(clientId, scenarioId, role);
      console.log(
        `[seed] ${clientId} ${role}: $0 canonical row ` +
          `(start ${anchors.planStartYear} · retirement ${anchors.retirementYear} · end ${anchors.planEndYear})`,
      );
      if (!anchors.hadDob) stats.seededWithoutDob += 1;
      if (!DRY_RUN) {
        await ensureRollbackSnapshot();
        await insertCanonicalSlot(clientId, scenarioId, role, anchors);
      }
      stats.seeded += 1;
    }

    for (const r of plan.reclassify) {
      console.log(`[reclassify] ${clientId}: ${r.id} "${r.name}" $${r.annualAmount} living → other`);
      if (!DRY_RUN) {
        await ensureRollbackSnapshot();
        await db.update(expenses).set({ type: "other" }).where(eq(expenses.id, r.id));
      }
      stats.reclassified += 1;
    }

    for (const { row, name } of plan.rename) {
      console.log(`[rename] ${clientId}: ${row.id} "${row.name}" → "${name}"`);
      if (!DRY_RUN) {
        await ensureRollbackSnapshot();
        await db.update(expenses).set({ name }).where(eq(expenses.id, row.id));
      }
      stats.renamed += 1;
    }

    for (const r of plan.forceGrowthSource) {
      console.log(
        `[growth] ${clientId}: ${r.id} "${r.name}" growth_source ${r.growthSource} → inflation`,
      );
      if (!DRY_RUN) {
        await ensureRollbackSnapshot();
        await db.update(expenses).set({ growthSource: "inflation" }).where(eq(expenses.id, r.id));
      }
      stats.growthSourceForced += 1;
    }
  }

  console.log(DRY_RUN ? "\nDRY RUN — nothing written." : "\nApplied.");
  console.table(stats);
}

/**
 * Milestone years for a seeded slot, mirroring create-client.ts's seeder.
 *
 * Birth year comes from the household's primary CRM contact — the same source
 * `create-client.ts` reads (identity lives on CRM contacts; the `clients` row
 * carries only planning fields and has no date_of_birth column). `plan_end_year`
 * is read straight off plan_settings, which is keyed per (client, scenario).
 */
async function resolveSlotAnchors(
  clientId: string,
  scenarioId: string,
  role: LivingRole,
): Promise<SlotAnchors> {
  const [c] = await db
    .select({
      retirementAge: clients.retirementAge,
      planEndAge: clients.planEndAge,
      dateOfBirth: crmHouseholdContacts.dateOfBirth,
    })
    .from(clients)
    .leftJoin(
      crmHouseholdContacts,
      and(
        eq(crmHouseholdContacts.householdId, clients.crmHouseholdId),
        eq(crmHouseholdContacts.role, "primary"),
      ),
    )
    .where(eq(clients.id, clientId));
  if (!c) throw new Error(`client ${clientId} not found`);

  const [ps] = await db
    .select({
      planStartYear: planSettings.planStartYear,
      planEndYear: planSettings.planEndYear,
    })
    .from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)));

  const planStartYear = ps?.planStartYear ?? new Date().getUTCFullYear();
  const birthYear = birthYearFromDob(c.dateOfBirth);
  if (birthYear == null) {
    // Legacy/imported households can lack a primary-contact DOB. Seed anyway:
    // the row is $0 and both years are milestone-anchored, and `lib/year-refs.ts`
    // re-resolves start/end from the refs on every load — so the stored literals
    // self-correct the moment a DOB exists. Skipping instead would leave the
    // scenario without its canonical slot, which the app now throws on.
    console.warn(
      `[warn] ${clientId}: no primary-contact date_of_birth — seeding ${role} slot with plan-start-anchored years`,
    );
  }

  return {
    planStartYear,
    retirementYear: birthYear == null ? planStartYear : birthYear + Number(c.retirementAge),
    planEndYear:
      ps?.planEndYear ?? (birthYear == null ? planStartYear + 30 : birthYear + Number(c.planEndAge)),
    hadDob: birthYear != null,
  };
}

/** Insert a $0 canonical slot with the canonical window for its role. */
async function insertCanonicalSlot(
  clientId: string,
  scenarioId: string,
  role: LivingRole,
  a: SlotAnchors,
) {
  const common = {
    clientId,
    scenarioId,
    type: "living" as const,
    name: CANONICAL_NAME[role],
    annualAmount: "0",
    growthRate: "0.03",
    growthSource: "inflation" as const,
    isDefault: true,
  };

  await db.insert(expenses).values(
    role === "current"
      ? {
          ...common,
          startYear: a.planStartYear,
          startYearRef: "plan_start" as const,
          endYear: Math.max(a.planStartYear, a.retirementYear),
          endYearRef: "client_retirement" as const,
          inflationStartYear: null,
        }
      : {
          ...common,
          startYear: a.retirementYear,
          startYearRef: "client_retirement" as const,
          endYear: Math.max(a.retirementYear, a.planEndYear),
          endYearRef: "plan_end" as const,
          inflationStartYear: a.planStartYear,
        },
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
