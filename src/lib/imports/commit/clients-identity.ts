import { and, eq } from "drizzle-orm";

import { clients } from "@/db/schema";
import { syncHouseholdNameFromContacts } from "@/lib/crm/sync-household-name";
import { upsertPrimaryAndSpouseContacts } from "@/lib/crm/upsert-household-contact";
import type { FilingStatus } from "@/lib/extraction/types";

import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * The extractor / import payload speaks IRS-style filing statuses
 * ("married_filing_jointly") but the DB `filing_status` enum uses the planning
 * vocabulary ("married_joint"). Translate before writing — otherwise Postgres
 * rejects the value with `invalid input value for enum filing_status` and the
 * entire commit transaction (names included) rolls back, surfacing only as a
 * generic "Commit failed."
 */
const FILING_STATUS_TO_DB: Record<
  FilingStatus,
  "single" | "married_joint" | "married_separate" | "head_of_household"
> = {
  single: "single",
  married_filing_jointly: "married_joint",
  married_filing_separately: "married_separate",
  head_of_household: "head_of_household",
};

/**
 * Commits the primary + spouse identity slots into the CRM household
 * (crm_household_contacts) and, transitionally, dual-writes the still-notNull
 * legacy columns on `clients` (firstName/lastName/dateOfBirth/spouseName/...).
 *
 * Field strategy:
 *   firstName / lastName / dateOfBirth → replace-if-non-null on CRM
 *     primary/spouse contacts
 *   filingStatus → planning-only, stays on the `clients` row
 *
 * CRM contact rows must already exist (Phase 6 backfill seeded them; new
 * clients are created via /api/clients which seeds them from the picker
 * selection). If the contact row is missing we skip that slot rather than
 * upsert — the import wizard shouldn't be the place that creates households.
 *
 * The dual-write to legacy `clients` columns disappears in Phase 9 when those
 * columns are dropped; only the CRM update + the filingStatus write remain.
 */
export async function commitClientsIdentity(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();

  const { primary, spouse } = payload;

  // ── 1. CRM contact updates (source of truth). ───────────────────────────
  // Look up the household via the planning client's crmHouseholdId.
  const [clientRow] = await tx
    .select({ crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));

  if (clientRow?.crmHouseholdId) {
    // Upsert both roles. A spouse row is INSERTED when the household started
    // single — the reason a single→married import used to lose the spouse (the
    // old update-only mirror matched zero rows).
    await upsertPrimaryAndSpouseContacts(
      tx,
      clientRow.crmHouseholdId,
      {
        primary: primary ? contactIdentityPatch(primary) : undefined,
        spouse: spouse ? contactIdentityPatch(spouse) : undefined,
      },
      primary?.lastName ?? null,
    );

    // Keep the denormalized household name tracking the contacts, same as the
    // CRM-edit (updateCrmContact) and planning PUT (/api/clients/[id]) paths.
    // An AI import that changes a primary/spouse name mirrors it into the CRM
    // contacts above but leaves crm_households.name stale otherwise.
    const nameChanged = Boolean(
      primary?.firstName ||
        primary?.lastName ||
        spouse?.firstName ||
        spouse?.lastName,
    );
    if (nameChanged) {
      await syncHouseholdNameFromContacts(tx, clientRow.crmHouseholdId);
    }
  }

  // ── 2. Legacy clients columns (dual-write until Phase 9). ───────────────
  const legacyUpdates: Record<string, unknown> = {};

  if (primary?.firstName) legacyUpdates.firstName = primary.firstName;
  if (primary?.lastName) legacyUpdates.lastName = primary.lastName;
  if (primary?.dateOfBirth) legacyUpdates.dateOfBirth = primary.dateOfBirth;
  if (primary?.filingStatus)
    legacyUpdates.filingStatus = FILING_STATUS_TO_DB[primary.filingStatus];

  if (spouse?.firstName) legacyUpdates.spouseName = spouse.firstName;
  if (spouse?.lastName) legacyUpdates.spouseLastName = spouse.lastName;
  if (spouse?.dateOfBirth) legacyUpdates.spouseDob = spouse.dateOfBirth;

  if (Object.keys(legacyUpdates).length === 0) {
    result.skipped = 1;
    return result;
  }

  legacyUpdates.updatedAt = new Date();

  const updated = await tx
    .update(clients)
    .set(legacyUpdates)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)))
    .returning({ id: clients.id });

  if (updated.length === 1) {
    result.updated = 1;
  } else {
    result.skipped = 1;
  }
  return result;
}

// Replace-if-non-null: build the CRM patch from only the fields the import
// actually extracted. Empty/undefined leaves the CRM value alone, which matters
// when the advisor has typed something the extractor couldn't recover. The
// insert-vs-update decision lives in upsertHouseholdContact.
function contactIdentityPatch(person: {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (person.firstName) patch.firstName = person.firstName;
  if (person.lastName) patch.lastName = person.lastName;
  if (person.dateOfBirth) patch.dateOfBirth = person.dateOfBirth;
  return patch;
}
