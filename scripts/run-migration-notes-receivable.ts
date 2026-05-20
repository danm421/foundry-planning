// One-shot migration: copy legacy `accounts.sub_type = 'promissory_note'`
// rows into the new `notes_receivable` table, port their owner rows, and
// delete the source account rows. Idempotent — re-running is safe (each
// per-account transaction either commits all writes or rolls back).
//
// Scenario-change rows that carry promissory_note payloads (e.g. IDGT
// sale-to-trust additions) are NOT touched. Those continue to flow through
// the legacy account path until Task 5.1 lands toggle-group support for
// notes_receivable.
//
// Usage:
//   npx tsx scripts/run-migration-notes-receivable.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  notesReceivable,
  noteReceivableOwners,
} from "@/db/schema";

async function main() {
  const legacyNotes = await db
    .select()
    .from(accounts)
    .where(eq(accounts.subType, "promissory_note"));

  console.log(`Found ${legacyNotes.length} legacy promissory_note accounts`);
  if (legacyNotes.length === 0) {
    console.log("Nothing to migrate. Done.");
    return;
  }

  for (const acct of legacyNotes) {
    const owners = await db
      .select()
      .from(accountOwners)
      .where(eq(accountOwners.accountId, acct.id));

    const faceValue = acct.basis ?? acct.value;
    const basis = acct.basis ?? acct.value;
    const interestRate = acct.noteInterestRate ?? "0";
    const paymentType = acct.notePaymentType ?? "amortizing";
    const startYear = acct.noteStartYear ?? new Date().getFullYear();
    const termMonths = acct.noteTermMonths ?? 120;

    await db.transaction(async (tx) => {
      const [newNote] = await tx
        .insert(notesReceivable)
        .values({
          clientId: acct.clientId,
          scenarioId: acct.scenarioId,
          name: acct.name,
          faceValue,
          basis,
          asOfBalance: acct.value,
          balanceAsOfMonth: new Date().getMonth() + 1,
          balanceAsOfYear: new Date().getFullYear(),
          interestRate,
          paymentType,
          startYear,
          startMonth: 1,
          termMonths,
          linkedTrustEntityId: acct.noteLinkedTrustEntityId,
        })
        .returning();

      for (const o of owners) {
        await tx.insert(noteReceivableOwners).values({
          noteReceivableId: newNote.id,
          familyMemberId: o.familyMemberId,
          entityId: o.entityId,
          externalBeneficiaryId: o.externalBeneficiaryId,
          percent: o.percent,
        });
      }

      await tx.delete(accounts).where(eq(accounts.id, acct.id));
    });

    console.log(`  migrated ${acct.name} (${acct.id})`);
  }

  console.log(`Migration complete — moved ${legacyNotes.length} note(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration script failed:", err);
    process.exit(1);
  });
