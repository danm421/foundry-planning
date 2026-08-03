// Migration 0229 — living expenses become a closed two-bucket set.
//
// Per (client_id, scenario_id) that owns living rows, in this order:
//   1. ADOPT OR SEED. For each role (current/retirement), if no is_default
//      living row with that role exists, promote one orphan — largest
//      annual_amount, tie-broken on oldest created_at — or insert a $0
//      canonical row when there is no orphan to promote.
//   2. RECLASSIFY. Every remaining non-default living row becomes `other`.
//      Name, amount, window and growth rate are preserved untouched.
//   3. NORMALISE. Force the canonical name and growth_source='inflation' on
//      the two default rows.
//
// Order is load-bearing: reversing 1 and 2 moves a client's real spending to
// Other and leaves them two $0 slots.
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
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, crmHouseholdContacts, expenses, planSettings } from "@/db/schema";
import { birthYearFromDob } from "@/lib/age-year";
import {
  LIVING_CURRENT_NAME,
  LIVING_RETIREMENT_NAME,
  livingSlotRole,
  type LivingRole,
} from "@/lib/living-expenses";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const rows = await db
    .select({
      id: expenses.id,
      clientId: expenses.clientId,
      scenarioId: expenses.scenarioId,
      name: expenses.name,
      annualAmount: expenses.annualAmount,
      startYearRef: expenses.startYearRef,
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

  const stats = {
    adopted: 0,
    seeded: 0,
    reclassified: 0,
    normalised: 0,
    scenarios: 0,
    seededWithoutDob: 0,
  };

  for (const [key, group] of groups) {
    const [clientId, scenarioId] = key.split("::");
    stats.scenarios += 1;

    const roleOf = (r: (typeof rows)[number]): LivingRole | null =>
      livingSlotRole(r.startYearRef);

    for (const role of ["current", "retirement"] as const) {
      const hasSlot = group.some((r) => r.isDefault && roleOf(r) === role);
      if (hasSlot) continue;

      // Largest amount wins; oldest created_at breaks the tie. Deterministic so
      // a re-run is idempotent.
      const orphans = group
        .filter((r) => !r.isDefault && roleOf(r) === role)
        .sort(
          (a, b) =>
            Number(b.annualAmount) - Number(a.annualAmount) ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        );

      if (orphans.length > 0) {
        const adopt = orphans[0];
        console.log(
          `[adopt] ${clientId} ${role}: "${adopt.name}" $${adopt.annualAmount}`,
        );
        if (!DRY_RUN) {
          await db.update(expenses).set({ isDefault: true }).where(eq(expenses.id, adopt.id));
        }
        // Flip in memory too, so the reclassify loop below skips the row we
        // just promoted and the normalise loop picks it up.
        adopt.isDefault = true;
        stats.adopted += 1;
      } else {
        console.log(`[seed] ${clientId} ${role}: inserting $0 canonical row`);
        if (!DRY_RUN) {
          const seeded = await insertCanonicalSlot(clientId, scenarioId, role);
          if (!seeded.hadDob) stats.seededWithoutDob += 1;
        }
        stats.seeded += 1;
      }
    }

    // 2. Reclassify every remaining extra.
    for (const r of group) {
      if (r.isDefault) continue;
      console.log(`[reclassify] ${clientId}: "${r.name}" $${r.annualAmount} living → other`);
      if (!DRY_RUN) {
        await db.update(expenses).set({ type: "other" }).where(eq(expenses.id, r.id));
      }
      stats.reclassified += 1;
    }

    // 3. Normalise the survivors. Rows inserted by insertCanonicalSlot are
    // already canonical and are not in `group`, so they need no second pass.
    for (const r of group) {
      if (!r.isDefault) continue;
      const role = roleOf(r);
      if (!role) continue;
      const name = role === "current" ? LIVING_CURRENT_NAME : LIVING_RETIREMENT_NAME;
      if (r.name === name) continue;
      console.log(`[normalise] ${clientId}: "${r.name}" → "${name}"`);
      if (!DRY_RUN) {
        await db
          .update(expenses)
          .set({ name, growthSource: "inflation" })
          .where(eq(expenses.id, r.id));
      }
      stats.normalised += 1;
    }
  }

  console.log(DRY_RUN ? "\nDRY RUN — nothing written." : "\nApplied.");
  console.table(stats);
}

/**
 * Insert a $0 canonical slot, mirroring create-client.ts's seeder.
 *
 * Birth year comes from the household's primary CRM contact — the same source
 * `create-client.ts` reads (identity lives on CRM contacts; the `clients` row
 * carries only planning fields and has no date_of_birth column). `plan_end_year`
 * is read straight off plan_settings rather than recomputed from a birth year.
 */
async function insertCanonicalSlot(
  clientId: string,
  scenarioId: string,
  role: LivingRole,
): Promise<{ hadDob: boolean }> {
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

  // plan_settings is per (client, scenario), not per client.
  const [ps] = await db
    .select({
      planStartYear: planSettings.planStartYear,
      planEndYear: planSettings.planEndYear,
    })
    .from(planSettings)
    .where(
      and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)),
    );

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
  const retirementYear =
    birthYear == null ? planStartYear : birthYear + Number(c.retirementAge);
  const planEndYear =
    ps?.planEndYear ??
    (birthYear == null ? planStartYear + 30 : birthYear + Number(c.planEndAge));

  await db.insert(expenses).values(
    role === "current"
      ? {
          clientId, scenarioId, type: "living" as const,
          name: LIVING_CURRENT_NAME, annualAmount: "0",
          startYear: planStartYear, startYearRef: "plan_start" as const,
          endYear: Math.max(planStartYear, retirementYear),
          endYearRef: "client_retirement" as const,
          growthRate: "0.03", growthSource: "inflation" as const,
          inflationStartYear: null, isDefault: true,
        }
      : {
          clientId, scenarioId, type: "living" as const,
          name: LIVING_RETIREMENT_NAME, annualAmount: "0",
          startYear: retirementYear, startYearRef: "client_retirement" as const,
          endYear: Math.max(retirementYear, planEndYear),
          endYearRef: "plan_end" as const,
          growthRate: "0.03", growthSource: "inflation" as const,
          inflationStartYear: planStartYear, isDefault: true,
        },
  );

  return { hadDob: birthYear != null };
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
