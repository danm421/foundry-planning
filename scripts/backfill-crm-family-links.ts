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
import { recordAudit } from "../src/lib/audit";
import { recordActivity } from "../src/lib/crm/activity";

// Non-interactive script actor — mirrors the "system:<job-name>" convention
// used by other unattended writers (src/lib/compliance-export/drain.ts,
// src/lib/billing/purge-firm.ts) so these rows are attributable and
// distinguishable from advisor/client edits in the audit + activity feeds.
const SCRIPT_ACTOR = "system:backfill-crm-family-links";

async function main() {
  const apply = process.argv.includes("--apply");
  const allClients = await db
    .select({ id: clients.id, crmHouseholdId: clients.crmHouseholdId, firmId: clients.firmId })
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
    const depsById = new Map(deps.map((d) => [d.id, d]));
    skipped += deps.length - links.size;
    for (const [contactId, familyMemberId] of links) {
      console.log(`${apply ? "LINK" : "would link"} contact ${contactId} -> member ${familyMemberId}`);
      if (apply) {
        await db
          .update(crmHouseholdContacts)
          .set({ familyMemberId, updatedAt: new Date() })
          .where(eq(crmHouseholdContacts.id, contactId));
        const dep = depsById.get(contactId);
        await recordAudit({
          action: "crm.contact.update",
          resourceType: "crm_contact",
          resourceId: contactId,
          firmId: client.firmId,
          clientId: client.id,
          actorId: SCRIPT_ACTOR,
          actorKind: "system",
          metadata: { familyMemberId, source: "backfill-crm-family-links" },
        });
        await recordActivity(
          {
            householdId: client.crmHouseholdId,
            kind: "contact_change",
            title: `Linked dependent: ${dep?.firstName ?? ""} ${dep?.lastName ?? ""}`,
            metadata: { contactId, familyMemberId },
            occurredAt: new Date(),
          },
          { actorUserId: SCRIPT_ACTOR },
        );
      }
      linked += 1;
    }
  }
  console.log(`${apply ? "Linked" : "Would link"} ${linked}; left unlinked ${skipped}.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
