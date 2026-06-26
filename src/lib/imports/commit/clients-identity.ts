import { and, eq } from "drizzle-orm";

import { clients, crmHouseholdContacts } from "@/db/schema";
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
    if (primary) {
      await upsertCrmContactIdentity(tx, clientRow.crmHouseholdId, "primary", {
        firstName: primary.firstName,
        lastName: primary.lastName,
        dateOfBirth: primary.dateOfBirth,
      });
    }
    if (spouse) {
      await upsertCrmContactIdentity(tx, clientRow.crmHouseholdId, "spouse", {
        firstName: spouse.firstName,
        lastName: spouse.lastName,
        dateOfBirth: spouse.dateOfBirth,
      });
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

// Replace-if-non-null update on the household's primary/spouse contact. Only
// writes the fields the import actually extracted — `undefined`/empty leaves
// the CRM value alone, which matters when the advisor has typed something into
// the CRM that the extractor couldn't recover.
async function upsertCrmContactIdentity(
  tx: Tx,
  householdId: string,
  role: "primary" | "spouse",
  patch: { firstName?: string; lastName?: string; dateOfBirth?: string | null },
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (patch.firstName) updates.firstName = patch.firstName;
  if (patch.lastName) updates.lastName = patch.lastName;
  if (patch.dateOfBirth) updates.dateOfBirth = patch.dateOfBirth;
  if (Object.keys(updates).length === 0) return;

  updates.updatedAt = new Date();

  await tx
    .update(crmHouseholdContacts)
    .set(updates)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, householdId),
        eq(crmHouseholdContacts.role, role),
      ),
    );
}
