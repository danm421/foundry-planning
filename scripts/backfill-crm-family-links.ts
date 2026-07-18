// Backfill: link legacy dependent CRM contact rows to planning family members
// by exact name (see src/lib/crm/family-link-backfill.ts). Dry-run by default;
// pass --apply to write.
//
//   DATABASE_URL="postgres://…" npx tsx scripts/backfill-crm-family-links.ts
//   DATABASE_URL="postgres://…" npx tsx scripts/backfill-crm-family-links.ts --apply

import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "../src/db";
import { clients, crmHouseholdContacts, familyMembers } from "../src/db/schema";
import { matchDependentsToFamily } from "../src/lib/crm/family-link-backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const allClients = await db
    .select({ id: clients.id, crmHouseholdId: clients.crmHouseholdId })
    .from(clients);

  let linked = 0;
  let skipped = 0;
  for (const client of allClients) {
    const deps = await db
      .select({
        id: crmHouseholdContacts.id,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
      })
      .from(crmHouseholdContacts)
      .where(and(
        eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
        eq(crmHouseholdContacts.role, "dependent"),
        isNull(crmHouseholdContacts.familyMemberId),
      ));
    if (deps.length === 0) continue;

    const famRows = await db
      .select({ id: familyMembers.id, firstName: familyMembers.firstName, lastName: familyMembers.lastName })
      .from(familyMembers)
      .where(and(
        eq(familyMembers.clientId, client.id),
        notInArray(familyMembers.role, ["client", "spouse"]),
      ));
    const alreadyLinked = famRows.length
      ? await db
          .select({ familyMemberId: crmHouseholdContacts.familyMemberId })
          .from(crmHouseholdContacts)
          .where(inArray(crmHouseholdContacts.familyMemberId, famRows.map((f) => f.id)))
      : [];
    const linkedIds = new Set(alreadyLinked.map((r) => r.familyMemberId));

    const links = matchDependentsToFamily(
      deps,
      famRows.map((f) => ({ ...f, linked: linkedIds.has(f.id) })),
    );
    skipped += deps.length - links.size;
    for (const [contactId, familyMemberId] of links) {
      console.log(`${apply ? "LINK" : "would link"} contact ${contactId} -> member ${familyMemberId}`);
      if (apply) {
        await db
          .update(crmHouseholdContacts)
          .set({ familyMemberId, updatedAt: new Date() })
          .where(eq(crmHouseholdContacts.id, contactId));
      }
      linked += 1;
    }
  }
  console.log(`${apply ? "Linked" : "Would link"} ${linked}; left unlinked ${skipped}.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
