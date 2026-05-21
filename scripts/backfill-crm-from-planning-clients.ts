// One-shot backfill: for every existing `clients` row without a crm_household_id,
// create a crm_households row + primary contact (+ optional spouse contact), then
// set clients.crm_household_id. Idempotent: skips clients that already have one.
//
// Usage: npx tsx scripts/backfill-crm-from-planning-clients.ts
// Pre-flight: snapshot the target Neon branch before running on a live DB.

import { db } from "../src/db";
import {
  clients,
  crmActivity,
  crmHouseholdContacts,
  crmHouseholds,
} from "../src/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

async function main() {
  const totalBefore = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM clients`,
  );
  const linkedBefore = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM clients WHERE crm_household_id IS NOT NULL`,
  );
  const totalN = (totalBefore.rows as { n: number }[])[0].n;
  const linkedN = (linkedBefore.rows as { n: number }[])[0].n;
  console.log(
    `[backfill] Starting. Clients total: ${totalN}, already linked: ${linkedN}`,
  );

  const unlinked = await db
    .select()
    .from(clients)
    .where(isNull(clients.crmHouseholdId));
  console.log(`[backfill] Found ${unlinked.length} clients to backfill.`);

  let warnings = 0;
  let migrated = 0;

  for (const client of unlinked) {
    if (!client.firstName || !client.lastName) {
      console.warn(
        `[backfill] client ${client.id} has empty firstName/lastName — using "Unknown"`,
      );
      warnings++;
    }

    await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(crmHouseholds)
        .values({
          firmId: client.firmId,
          advisorId: client.advisorId,
          name: `${client.lastName || "Unknown"} Household`,
          status: "active",
        })
        .returning();

      await tx.insert(crmHouseholdContacts).values({
        householdId: household.id,
        role: "primary",
        firstName: client.firstName || "Unknown",
        lastName: client.lastName || "Unknown",
        dateOfBirth: client.dateOfBirth,
        email: client.email || null,
        addressLine1: client.address,
      });

      if (client.spouseName) {
        await tx.insert(crmHouseholdContacts).values({
          householdId: household.id,
          role: "spouse",
          firstName: client.spouseName,
          lastName: client.spouseLastName || client.lastName || "Unknown",
          dateOfBirth: client.spouseDob,
          email: client.spouseEmail || null,
          addressLine1: client.spouseAddress || client.address,
        });
      }

      await tx
        .update(clients)
        .set({ crmHouseholdId: household.id })
        .where(eq(clients.id, client.id));

      await tx.insert(crmActivity).values({
        householdId: household.id,
        firmId: client.firmId,
        kind: "planning_link",
        title: "Migrated from planning client",
        metadata: { planningClientId: client.id },
        occurredAt: client.createdAt,
      });
    });
    migrated++;
  }

  const linkedAfter = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM clients WHERE crm_household_id IS NOT NULL`,
  );
  const totalHouseholds = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM crm_households`,
  );
  const linkedAfterN = (linkedAfter.rows as { n: number }[])[0].n;
  const totalHouseholdsN = (totalHouseholds.rows as { n: number }[])[0].n;

  console.log(`[backfill] Done.`);
  console.log(`  Migrated:       ${migrated}`);
  console.log(`  Warnings:       ${warnings}`);
  console.log(
    `  Linked total:   ${linkedAfterN} (expected: ${totalN})`,
  );
  console.log(`  CRM households: ${totalHouseholdsN}`);

  if (linkedAfterN !== totalN) {
    console.error(
      `[backfill] MISMATCH — not all clients linked. Investigate before running migration 2.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
