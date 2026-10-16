// src/lib/fact-finder/save/__tests__/harness.ts
/**
 * What every save writers test uses (Plan 4, Tasks 2–14): a client as the app
 * creates one, a SaveContext on a real transaction that commits or rolls back,
 * and change lines built by the review's own code (DraftBuilder → diffDrafts)
 * whose request bodies come from payloadFor — never written by hand.
 *
 * This file imports `@/db`, but vitest sorts test files by their own source: a
 * test that uses it must itself import `db` from "@/db" (or read DATABASE_URL),
 * or it lands in the unit project, where every connection fails. The cores
 * check access through the Clerk session, so that test also mocks
 * `@clerk/nextjs/server` with `auth: async () => ({ userId: SAVE_ACTOR, orgId: <its firm>, orgRole: "org:admin" })`.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  auditLog,
  clients,
  crmHouseholdContacts,
  crmHouseholds,
  familyMembers,
  gifts,
  modelPortfolios,
  tickerPortfolios,
  trustSplitInterestDetails,
} from "@/db/schema";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { buildHouseholdName } from "@/lib/crm/household-name";
import { afterCommitQueue } from "@/lib/db-tx";
import { refKey, type ChangeLine, type PlacedValue, type TargetKind } from "../../change-set";
import { diffDrafts } from "../../placement/diff";
import { DraftBuilder } from "../../placement/map/helpers";
import { lineValues, payloadFor, type Resolve } from "../../placement/payload";
import { TARGETS } from "../../placement/targets";
import { emptyRecordBook } from "../../placement/types";
import type { SaveContext, SaveInput } from "../types";

/** Who a SaveContext writes as — the userId a test's Clerk mock returns. */
export const SAVE_ACTOR = "user_test_ff_save";
/** The year every milestone resolves to in inputOf. */
export const REF_YEAR = 2030;

const ADVISOR = "user_test_ff_save_advisor";
const MARK = { firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12" };
const LAURA = { firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30" };

export interface SaveSeed {
  clientId: string;
  scenarioId: string;
  householdId: string;
  clientMemberId: string;
  spouseMemberId: string | null;
}

/**
 * A client as the app creates one (createClientForHousehold): household and
 * primary contact, the client row, a base case with plan settings, family
 * members, household cash, the default living expenses and Social Security —
 * and with `coClient`, Laura's contact and family member. No audit rows, so a
 * test can say exactly which ones its writes left.
 */
export async function seedSaveClient(firmId: string, opts: { coClient?: boolean } = {}): Promise<SaveSeed> {
  const spouse = opts.coClient ? LAURA : null;
  const name = buildHouseholdName({ ...MARK, spouseFirstName: spouse?.firstName, spouseLastName: spouse?.lastName });
  const [household] = await db.insert(crmHouseholds).values({ firmId, advisorId: ADVISOR, name, state: "CO" }).returning({ id: crmHouseholds.id });
  await db.insert(crmHouseholdContacts).values([
    { householdId: household.id, role: "primary", ...MARK },
    ...(spouse ? [{ householdId: household.id, role: "spouse" as const, ...spouse }] : []),
  ]);
  const { clientId, scenarioId } = await createClientForHousehold({
    household: { id: household.id, firmId, advisorId: ADVISOR, state: "CO" },
    primaryContact: MARK,
    spouseContact: spouse,
    retirementAge: 65,
    lifeExpectancy: 92,
    filingStatus: spouse ? "married_joint" : "single",
  });
  await db.delete(auditLog).where(eq(auditLog.clientId, clientId));
  const members = await db.select({ id: familyMembers.id, role: familyMembers.role }).from(familyMembers).where(eq(familyMembers.clientId, clientId));
  return {
    clientId,
    scenarioId,
    householdId: household.id,
    clientMemberId: members.find((m) => m.role === "client")!.id,
    spouseMemberId: members.find((m) => m.role === "spouse")?.id ?? null,
  };
}

/**
 * Everything under the firm: its clients and every row that cascades from them,
 * its households and their contacts, the portfolios and asset classes a test
 * made for it, its audit rows.
 */
export async function dropSaveFirm(firmId: string): Promise<void> {
  const clientIds = (await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId))).map((r) => r.id);
  if (clientIds.length > 0) {
    // Gifts first (records-book.test.ts' order); split-interest details hold RESTRICT links to family members and charities.
    await db.delete(gifts).where(inArray(gifts.clientId, clientIds));
    await db.delete(trustSplitInterestDetails).where(inArray(trustSplitInterestDetails.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
  }
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
  await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));
  await db.delete(tickerPortfolios).where(eq(tickerPortfolios.firmId, firmId));
  await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
  await db.delete(auditLog).where(eq(auditLog.firmId, firmId));
}

const ROLLBACK = new Error("inSave: rolled back on purpose");

/**
 * Runs `fn` with a SaveContext on a real transaction at the save's own
 * isolation level (REPEATABLE READ, save.ts), then commits — or, with
 * `rollback`, throws after `fn` so nothing lands. `result` is fn's return
 * value either way (a test can look for the rows it would have made). Queued
 * work runs only on `flush()`; after a rollback the queue is dropped, as the
 * save drops it.
 */
export async function inSave<T>(
  seed: { clientId: string; firmId: string },
  fn: (ctx: SaveContext) => Promise<T>,
  opts: { rollback?: boolean; actorId?: string } = {},
): Promise<{ result: T; flush(): Promise<void>; queued: number }> {
  const queue = afterCommitQueue();
  let result!: T;
  try {
    await db.transaction(
      async (tx) => {
        result = await fn({
          tx,
          clientId: seed.clientId,
          firmId: seed.firmId,
          actorId: opts.actorId ?? SAVE_ACTOR,
          afterCommit: queue.afterCommit,
          holdings: new Map(),
        });
        if (opts.rollback) throw ROLLBACK;
      },
      { isolationLevel: "repeatable read" },
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return { result, queued: queue.size(), flush: opts.rollback ? async () => {} : queue.flush };
}

/** The fact finder section that places each target: a line's page and section. */
const SECTION_OF: Record<TargetKind, string> = {
  client_household: "people", plan_settings_tax_rates: "people", family_member: "family",
  external_beneficiary: "external", related_party: "estate_docs",
  account: "taxable", business_account: "business", account_beneficiary_designation: "retirement",
  annuity_contract: "annuity", stock_option_account: "equity", stock_option_grant: "equity",
  note_receivable: "notes_rec", liability: "liab", income: "income", expense: "expenses", savings_rule: "savings",
  life_insurance_policy: "life", life_insurance_policy_beneficiary: "life", disability_policy: "disability", ltc_policy: "ltc",
  entity: "trusts", trust_beneficiary_designation: "trusts", revocable_trust: "trusts",
  will: "estate_docs", will_bequest: "bequests", will_residuary_recipient: "bequests",
  gift: "gifts", plan_observation: "final_notes",
};

let rows = 0;

/**
 * A change line as the review builds one: `fields` (key → value, in order)
 * through DraftBuilder and diffDrafts, so a blank value is no field, `fixed`
 * rides on a Create only, and every line ref makes a `dependsOn`. A
 * `recordId` makes an Update against a record whose values are all empty
 * (every field a change, every one ticked). `with`: a field's companions
 * (growthRate → { growthSource: "custom" }), as the section maps put them.
 */
export function changeLine(
  target: TargetKind,
  fields: Record<string, PlacedValue>,
  opts: Partial<Pick<ChangeLine, "id" | "action" | "recordId" | "fixed" | "parent" | "dependsOn" | "label">> & {
    with?: Record<string, Record<string, PlacedValue>>;
  } = {},
): ChangeLine {
  const recordId = opts.recordId ?? null;
  const label = opts.label ?? TARGETS[target].label;
  const draft = new DraftBuilder({
    sectionId: SECTION_OF[target],
    row: { id: `row-${++rows}`, cells: {}, sourceFileIds: [] },
    target,
    recordId,
    label,
    ...(opts.fixed ? { fixed: opts.fixed } : {}),
    ...(opts.parent ? { parent: opts.parent } : {}),
  });
  for (const [key, value] of Object.entries(fields)) draft.put(key, value, [key], opts.with?.[key]);
  const book = emptyRecordBook("harness");
  if (recordId !== null) book.records[target] = [{ id: recordId, label, values: {} }];
  const [line] = diffDrafts([draft.build()], book);
  return {
    ...line,
    ...(opts.id ? { id: opts.id } : {}),
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}),
  };
}

/**
 * lineValues + payloadFor with a resolve built from `ids` (refKey → id: "line:<lineId>",
 * "person:client", …) and REF_YEAR for every milestone. A record ref is its own id; any
 * other ref missing from `ids` throws.
 */
export function inputOf(
  line: ChangeLine,
  ids: Record<string, string> = {},
  extra: { recordId?: string | null; parentId?: string | null } = {},
): SaveInput {
  const resolve: Resolve = {
    id: (ref) => {
      const id = ids[refKey(ref)] ?? (ref.ref === "record" ? ref.id : undefined);
      if (!id) throw new Error(`inputOf: no id for ${refKey(ref)} — pass it in ids`);
      return id;
    },
    year: () => REF_YEAR,
  };
  const values = lineValues(line);
  return {
    line,
    values,
    body: payloadFor(line.target, values, resolve),
    recordId: extra.recordId === undefined ? line.recordId : extra.recordId,
    parentId: extra.parentId === undefined ? (line.parent ? resolve.id(line.parent) : null) : extra.parentId,
  };
}
