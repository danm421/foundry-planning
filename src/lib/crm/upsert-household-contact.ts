import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";

// Drizzle transaction handle — same convention used in
// src/lib/clients/mirror-contact-to-crm.ts and src/lib/ownership.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Minimal contact shape needed to decide insert-vs-update per role and to
// satisfy the NOT NULL last_name column when synthesizing a new spouse row.
interface ContactStub {
  id: string;
  role: string;
  lastName: string | null;
}

// One SELECT of the household's contacts; role selection happens in memory.
// Keeping it to a single query (rather than a per-role WHERE) is also what lets
// the write path stay unit-testable against the fake-tx harness, which can't
// discriminate two same-table selects by their WHERE clause.
async function loadContactStubs(
  tx: Tx,
  householdId: string,
): Promise<ContactStub[]> {
  return tx
    .select({
      id: crmHouseholdContacts.id,
      role: crmHouseholdContacts.role,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, householdId));
}

// Insert-or-update one contact role from a partial patch of CRM columns.
//   existing row → UPDATE the provided fields.
//   no row       → INSERT, but ONLY when the patch carries a non-empty
//                  firstName (first_name / last_name are NOT NULL). A
//                  detail-only patch (email/phone, no name) can't materialize a
//                  nameless row, so it no-ops.
// onConflictDoNothing closes the SELECT→INSERT race: if a concurrent
// transaction inserts the same role between our SELECT and INSERT, we skip
// rather than surface an unhandled unique-violation (one-primary/one-spouse
// partial indexes).
async function upsertContactRole(
  tx: Tx,
  householdId: string,
  role: "primary" | "spouse",
  patch: Record<string, unknown>,
  existing: ContactStub | undefined,
  fallbackLastName: string | null,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  if (existing) {
    await tx
      .update(crmHouseholdContacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(crmHouseholdContacts.id, existing.id));
    return;
  }

  const firstName = patch.firstName;
  if (typeof firstName !== "string" || firstName.trim() === "") return;

  const patchLast = patch.lastName;
  const lastName =
    typeof patchLast === "string" && patchLast.trim() !== ""
      ? patchLast
      : fallbackLastName ?? "";

  await tx
    .insert(crmHouseholdContacts)
    .values({ householdId, role, ...patch, firstName, lastName })
    .onConflictDoNothing();
}

/**
 * Insert-or-update a household's primary and/or spouse contact from partial
 * column patches (only put a key in a patch to write it).
 *
 * This is THE single place a household transitions single → married: when no
 * spouse row exists yet, the spouse patch is INSERTED. The older mirror helpers
 * (mirrorContactToCrm, the import's inline update) were UPDATE-only and
 * silently dropped a spouse whenever no spouse row existed — exactly the case
 * for a client created single.
 *
 * `spouseFallbackLastName` (typically the incoming primary's last name)
 * satisfies the NOT NULL last_name column when the spouse patch omits a last
 * name; an already-stored primary last name is preferred over it.
 */
export async function upsertPrimaryAndSpouseContacts(
  tx: Tx,
  householdId: string,
  patches: {
    primary?: Record<string, unknown>;
    spouse?: Record<string, unknown>;
  },
  spouseFallbackLastName: string | null = null,
): Promise<void> {
  const stubs = await loadContactStubs(tx, householdId);
  const primaryStub = stubs.find((c) => c.role === "primary");

  if (patches.primary) {
    await upsertContactRole(
      tx,
      householdId,
      "primary",
      patches.primary,
      primaryStub,
      null,
    );
  }
  if (patches.spouse) {
    await upsertContactRole(
      tx,
      householdId,
      "spouse",
      patches.spouse,
      stubs.find((c) => c.role === "spouse"),
      primaryStub?.lastName ?? spouseFallbackLastName,
    );
  }
}
