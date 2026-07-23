import { and, eq } from "drizzle-orm";

import { clients, crmHouseholdContacts, planSettings } from "@/db/schema";
import { computePlanEndAge, computePlanEndYear } from "@/lib/plan-horizon";
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
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      lifeExpectancy: clients.lifeExpectancy,
      spouseLifeExpectancy: clients.spouseLifeExpectancy,
      spouseRetirementAge: clients.spouseRetirementAge,
      spouseRetirementMonth: clients.spouseRetirementMonth,
    })
    .from(clients)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));

  if (clientRow?.crmHouseholdId) {
    // Existing contacts, read once BEFORE the upsert: the horizon recompute in
    // seedSpousePlanningDefaults falls back to the stored primary/spouse DOB
    // when the payload omits it, and the single→married gate keys off whether a
    // spouse row pre-exists.
    const existingContacts = await tx
      .select({
        role: crmHouseholdContacts.role,
        dateOfBirth: crmHouseholdContacts.dateOfBirth,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));

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

    // Single → married: seed the spouse's planning defaults + extend the plan
    // horizon. Detected here because this is where the spouse row first appears
    // in the import path.
    await seedSpousePlanningDefaults(
      tx,
      ctx,
      clientRow,
      existingContacts,
      primary,
      spouse,
      result,
    );
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

// Spouse planning defaults applied on a single → married transition. Mirrors
// the values create-client.ts seeds at create time (the analogous chokepoint);
// keeping them named makes the policy explicit and referenced once each.
const SPOUSE_DEFAULT_RETIREMENT_AGE = 65;
const SPOUSE_DEFAULT_RETIREMENT_MONTH = 1;
const SPOUSE_DEFAULT_LIFE_EXPECTANCY = 95;

/**
 * Single → married: seed the spouse's null planning columns (retirement age /
 * month / life expectancy) and re-derive the plan horizon so it extends past
 * the primary's death year when the spouse outlives them.
 *
 * No-op unless a spouse will exist AND the STORED spouseLifeExpectancy is null.
 * Gating on the stored value is what makes this reliable: create-client always
 * writes 95 when a spouse exists, so null means the household was created single
 * (or is legacy-null, where seeding 95 is still correct). Keying off the stored
 * value — not the payload — also makes this a clean no-op once the value is set,
 * including when the Plan basics tab (earlier in COMMIT_TABS) already wrote it
 * in this same transaction.
 *
 * Horizon inputs come from the payload when the import carries them, else the
 * stored CRM contacts — mirroring the PATCH path's `body.X ?? contact.X`. Only
 * null planning columns are filled; advisor-set values are never clobbered.
 *
 * NOTE: the horizon recompute + planSettings propagation here is a near-copy of
 * `plan-basics.ts`'s `resolvePlanHorizon` and the PATCH route's block; a shared
 * "persist plan horizon" helper is tracked as future work.
 */
async function seedSpousePlanningDefaults(
  tx: Tx,
  ctx: CommitContext,
  clientRow: {
    lifeExpectancy: number;
    spouseLifeExpectancy: number | null;
    spouseRetirementAge: number | null;
    spouseRetirementMonth: number | null;
  },
  existingContacts: { role: string; dateOfBirth: string | null }[],
  primary: ImportPayload["primary"],
  spouse: ImportPayload["spouse"],
  result: CommitResult,
): Promise<void> {
  const spouseWillExist =
    existingContacts.some((c) => c.role === "spouse") || Boolean(spouse?.firstName);
  if (!spouseWillExist || clientRow.spouseLifeExpectancy != null) return;

  const spousePatch: Record<string, unknown> = {
    spouseRetirementAge: clientRow.spouseRetirementAge ?? SPOUSE_DEFAULT_RETIREMENT_AGE,
    spouseRetirementMonth:
      clientRow.spouseRetirementMonth ?? SPOUSE_DEFAULT_RETIREMENT_MONTH,
    spouseLifeExpectancy: SPOUSE_DEFAULT_LIFE_EXPECTANCY,
  };

  const primaryDob =
    primary?.dateOfBirth ??
    existingContacts.find((c) => c.role === "primary")?.dateOfBirth ??
    null;
  const spouseDob =
    spouse?.dateOfBirth ??
    existingContacts.find((c) => c.role === "spouse")?.dateOfBirth ??
    null;

  let planEndYear: number | null = null;
  if (primaryDob) {
    const planEndAge = computePlanEndAge({
      clientDob: primaryDob,
      clientLifeExpectancy: clientRow.lifeExpectancy,
      spouseDob,
      spouseLifeExpectancy: SPOUSE_DEFAULT_LIFE_EXPECTANCY,
    });
    spousePatch.planEndAge = planEndAge;
    planEndYear = computePlanEndYear(primaryDob, planEndAge);
  } else {
    result.warnings.push(
      "Life expectancy saved, but the plan horizon could not be recomputed — " +
        "no date of birth on file for the primary client.",
    );
  }

  await tx
    .update(clients)
    .set({ ...spousePatch, updatedAt: new Date() })
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));

  if (planEndYear != null) {
    // Every scenario, not just this import's — matching plan-basics / the PATCH
    // path, so engine + UI stay in sync without a manual re-save.
    await tx
      .update(planSettings)
      .set({ planEndYear, updatedAt: new Date() })
      .where(eq(planSettings.clientId, ctx.clientId));
  }
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
