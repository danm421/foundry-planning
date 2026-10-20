// src/domain/mcp/__tests__/household-building-e2e.test.ts
//
// Live dev database: Claude builds a household from nothing, as the connector
// makes the calls — a principal, no Clerk session. create_household opens step
// 0; each step is started, filled, reviewed and saved through the fact
// finder's own cores; a near-match row is refused rather than saved on a
// guess; then one single edit, two removals, and what the plan still lacks.
// A likely duplicate is caught by the live query, and a second firm's
// principal is refused at every step. Everything lives under firm ids no
// other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// No session at all: every access check, and every audit row's actor, must come from the principal.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null, orgId: null, orgRole: null, actor: null }),
}));
// The firm's switch is on, and the rate limits allow the call — neither is what these tests are about.
vi.mock("@/lib/firm-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firm-settings")>()),
  firmClaudeWritesEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkMcpRateLimit: async () => ({ allowed: true, remaining: 1, reset: 0 }),
  checkImportRateLimit: async () => ({ allowed: true, remaining: 1, reset: 0 }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, clientImports, clients, crmHouseholds, expenses, familyMembers, incomes, planSettings } from "@/db/schema";
import { SAVE_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import { dropSaveFirm } from "@/lib/fact-finder/save/__tests__/harness";
import { readFactFinderState } from "@/lib/fact-finder/state";
import { CLAUDE_FILE_ID } from "@/lib/fact-finder/types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { McpInputError } from "../define-tool";
import type { StepView } from "../fact-finder-steps";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
import { householdBuildingTools } from "../tools/household-building";

const FIRM = "firm_test_mcp_household_e2e";
const OTHER_FIRM = "firm_test_mcp_household_e2e_other";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const principalOf = (orgId: string, userId: string): McpPrincipal => ({
  userId,
  orgId,
  orgRole: "org:admin",
  scopes: [],
  tokenSubject: userId,
  canWrite: true,
  entitlements: ["ai_import"],
});
const PRINCIPAL = principalOf(FIRM, "user_test_mcp_household_e2e");
const OUTSIDER = principalOf(OTHER_FIRM, "user_test_mcp_household_e2e_other");

const MARK = { firstName: "Mark", lastName: "Check", dateOfBirth: "1968-04-12", retirementAge: 65 };
const LAURA = { firstName: "Laura", lastName: "Check", dateOfBirth: "1970-09-30", retirementAge: 63 };
const STATEMENT = { document: "Schwab IRA statement, September 2026.pdf", page: 1, quote: "Ending account value $250,000.00" };

const run = (name: string, args: Record<string, unknown>, principal: McpPrincipal = PRINCIPAL) =>
  householdBuildingTools.find((t) => t.name === name)!.run(args, principal);

/** What a call threw; "not refused" when it didn't. */
const refusalOf = (call: Promise<unknown>) => call.then(() => "not refused", (err: unknown) => err);

type Started = StepView & { importId: string; version: number };
type Created = Started & { created: true; clientId: string; householdId: string };
type Filled = { version: number; needsDecision: unknown[] };
type Reviewed = { changeSetVersion: number; lines: { action: string; what: string; label: string }[] };
type Saved = { saved: { create: number; update: number }; leftOut: unknown[] };
type Missing = { missing: { step: string; label: string; missing: string }[] };

async function createHousehold(principal: McpPrincipal, household: Record<string, unknown>): Promise<Created> {
  const out = (await run("create_household", { household }, principal)) as Created;
  expect(out).toMatchObject({ created: true, clientId: expect.any(String), importId: expect.any(String) });
  return out;
}

/** One step's draft filled, reviewed and saved, as Claude makes the calls. */
async function fillReviewSave(clientId: string, importId: string, version: number, rows: unknown[]) {
  const filled = (await run("fill_fact_finder_step", { clientId, importId, baseVersion: version, rows })) as Filled;
  expect(filled.needsDecision).toEqual([]);
  const reviewed = (await run("review_fact_finder_step", { clientId, importId })) as Reviewed;
  const saved = (await run("save_fact_finder_step", { clientId, importId, changeSetVersion: reviewed.changeSetVersion })) as Saved;
  return { reviewed, saved };
}

const startStep = async (clientId: string, step: string) => (await run("start_fact_finder_step", { clientId, step })) as Started;

const accountsOf = (clientId: string) =>
  db
    .select({ id: accounts.id, name: accounts.name, category: accounts.category, subType: accounts.subType, value: accounts.value, custodian: accounts.custodian, isDefaultChecking: accounts.isDefaultChecking })
    .from(accounts)
    .where(eq(accounts.clientId, clientId));

const importOf = async (importId: string) => {
  const [imp] = await db.select({ status: clientImports.status, payloadJson: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.id, importId));
  return { status: imp.status, state: readFactFinderState(imp.payloadJson) };
};

/** Who the review's audit row names: the principal, or — had it read the session — "system". */
const reviewedBy = async (importId: string) =>
  (
    await db
      .select({ actorId: auditLog.actorId })
      .from(auditLog)
      .where(and(eq(auditLog.resourceId, importId), eq(auditLog.action, "import.fact_finder_reviewed")))
  ).map((r) => r.actorId);

/** Everything a refused call could have touched on a household's plan. */
async function planOf(clientId: string) {
  const imports = await db.select({ id: clientImports.id, status: clientImports.status, payloadJson: clientImports.payloadJson }).from(clientImports).where(eq(clientImports.clientId, clientId));
  return {
    client: await db.select().from(clients).where(eq(clients.id, clientId)),
    settings: await db.select().from(planSettings).where(eq(planSettings.clientId, clientId)),
    accounts: await accountsOf(clientId),
    incomes: await db.select({ id: incomes.id }).from(incomes).where(eq(incomes.clientId, clientId)),
    expenses: await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.clientId, clientId)),
    family: await db.select({ id: familyMembers.id }).from(familyMembers).where(eq(familyMembers.clientId, clientId)),
    imports: imports.map((i) => ({ id: i.id, status: i.status, version: readFactFinderState(i.payloadJson).version })),
    toolWrites: await db.select({ actorId: auditLog.actorId }).from(auditLog).where(and(eq(auditLog.clientId, clientId), eq(auditLog.action, "mcp.tool_write"))),
  };
}

d("Claude builds a household end to end, on a principal with no session (live DB)", () => {
  // Clearing a firm of its households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => Promise.all([dropSaveFirm(FIRM), dropSaveFirm(OTHER_FIRM)]), 120_000);
  afterAll(async () => Promise.all([dropSaveFirm(FIRM), dropSaveFirm(OTHER_FIRM)]), 120_000);

  it("creates the household, saves three steps, edits a fixed row and removes a row", async () => {
    // Step 0: the household, its plan and step 0's draft, which has never been edited — returned
    // as start_fact_finder_step returns a step, so it is filled from the result alone.
    const home = await createHousehold(PRINCIPAL, {
      name: "Check Household",
      state: "CO",
      primary: MARK,
      spouse: LAURA,
      filingStatus: "married_joint",
    });
    const { clientId } = home;
    expect(home).toMatchObject({ version: 0, step: { id: "household" } });
    expect(home.sections.map((s) => s.id)).toEqual(["people", "household", "family", "external"]);
    const step0 = await fillReviewSave(clientId, home.importId, home.version, [
      { sectionId: "family", cells: { firstName: "Emma", lastName: "Check", relationship: "Child", dateOfBirth: "2003-05-21" } },
    ]);
    expect(step0.reviewed.lines).toMatchObject([{ action: "create", what: "Family member", label: expect.stringContaining("Emma") }]);
    expect(step0.saved).toMatchObject({ saved: { create: 1, update: 0 }, leftOut: [] });

    // Before the income step, Mark lacks a salary.
    const before = (await run("get_missing_facts", { clientId })) as Missing;
    expect(before.missing).toContainEqual(expect.objectContaining({ step: "income", label: "Mark", missing: "a salary, or confirmation there is none" }));

    // The balance sheet: a Schwab IRA cited to its statement, and checking filled into the seeded Household Cash.
    const sheet = await startStep(clientId, "balance_sheet");
    const seededCash = sheet.existingRecords.find((r) => r.target === "account" && r.seeded);
    expect(seededCash).toMatchObject({ label: "Household Cash" });
    const step1 = await fillReviewSave(clientId, sheet.importId, sheet.version, [
      {
        sectionId: "retirement",
        cells: { accountName: "Schwab IRA", currentValue: 250000, owner: "Client", custodian: "Schwab", accountType: "Traditional IRA" },
        sources: { currentValue: STATEMENT },
      },
      {
        sectionId: "cash",
        cells: { accountName: "Chase Checking", currentValue: 18500, accountType: "Checking" },
        link: { recordId: seededCash!.recordId },
      },
    ]);
    expect(step1.saved.saved).toEqual({ create: 1, update: 1 });

    // Income: Mark's salary.
    const income = await startStep(clientId, "income");
    const step2 = await fillReviewSave(clientId, income.importId, income.version, [
      { sectionId: "salary", fixedRow: "Client", cells: { employer: "Front Range Engineering", annualSalary: 145000, annualRaise: 3 } },
    ]);
    // The salary is a new income; the employer is a field of the household record.
    expect(step2.saved.saved).toEqual({ create: 1, update: 1 });

    // Each review read the record book and wrote its audit row as the principal — no session to fall back on.
    for (const importId of [home.importId, sheet.importId, income.importId]) {
      expect(await reviewedBy(importId)).toEqual([PRINCIPAL.userId]);
      expect((await importOf(importId)).status).toBe("committed");
    }

    // One IRA; one checking — the seeded row, now funded, its name kept (a name on record starts left out).
    const held = await accountsOf(clientId);
    expect(held.filter((a) => a.category === "retirement")).toEqual([
      expect.objectContaining({ name: "Schwab IRA", subType: "traditional_ira", custodian: "Schwab", value: "250000.00" }),
    ]);
    expect(held.filter((a) => a.category === "cash")).toEqual([
      expect.objectContaining({ id: seededCash!.recordId, name: "Household Cash", isDefaultChecking: true, value: "18500.00" }),
    ]);

    // A row the matcher scores between the floor (0.45) and the auto-link score (0.90) against the saved IRA:
    // the fill names it, the review refuses over it, and nothing lands on a guess.
    const ira = held.find((a) => a.category === "retirement")!;
    const recheck = await startStep(clientId, "balance_sheet");
    const nearMatch = (await run("fill_fact_finder_step", {
      clientId,
      importId: recheck.importId,
      baseVersion: recheck.version,
      rows: [{ sectionId: "retirement", cells: { accountName: "Schwab Traditional IRA", currentValue: 252000, owner: "Client", custodian: "Schwab" } }],
    })) as { version: number; needsDecision: { sectionId: string; rowId: string; label: string; candidates: { recordId: string; score: number }[] }[] };
    const near = { sectionId: "retirement", rowId: expect.any(String), label: "Schwab Traditional IRA", candidates: [{ recordId: ira.id, label: "Schwab IRA", score: expect.any(Number) }] };
    expect(nearMatch.needsDecision).toEqual([near]);
    const { rowId, candidates: [{ score }] } = nearMatch.needsDecision[0];
    expect(score).toBeGreaterThanOrEqual(0.45);
    expect(score).toBeLessThan(0.9);
    expect(await refusalOf(run("review_fact_finder_step", { clientId, importId: recheck.importId }))).toEqual(
      new McpInputError("1 link needs a click first.", { needsDecision: [{ ...near, rowId }] }),
    );
    // No change list was built, so there is nothing a save could land.
    expect(
      await refusalOf(run("save_fact_finder_step", { clientId, importId: recheck.importId, changeSetVersion: nearMatch.version + 1 })),
    ).toEqual(new McpInputError(SAVE_STALE_MESSAGE));
    expect(await accountsOf(clientId)).toEqual(held);
    expect((await importOf(recheck.importId)).status).toBe("draft");

    // The salary is Mark's, and the child is in the family.
    const salaries = await db
      .select({ id: incomes.id, name: incomes.name, owner: incomes.owner, annualAmount: incomes.annualAmount })
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.type, "salary")));
    expect(salaries).toEqual([expect.objectContaining({ owner: "client", annualAmount: "145000.00" })]);
    const family = await db
      .select({ firstName: familyMembers.firstName, relationship: familyMembers.relationship })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId));
    expect(family).toContainEqual({ firstName: "Emma", relationship: "child" });

    // The IRA's value cites the statement Claude read; Foundry holds no file for it.
    const iraRow = (await importOf(sheet.importId)).state.sections.retirement.find((r) => r.cells.accountName?.value === "Schwab IRA");
    expect(iraRow?.cells.currentValue?.source).toEqual({
      fileId: CLAUDE_FILE_ID,
      documentName: STATEMENT.document,
      page: STATEMENT.page,
      snippet: STATEMENT.quote,
    });

    // What the plan still lacks: Mark's salary no longer, living expenses still.
    const after = (await run("get_missing_facts", { clientId })) as Missing;
    expect(after.missing).not.toContainEqual(expect.objectContaining({ label: "Mark", missing: "a salary, or confirmation there is none" }));
    expect(after.missing).toContainEqual(expect.objectContaining({ step: "living_expenses", missing: "current living expenses" }));

    // A single edit of a fixed row: the Client's retirement age, saved at once.
    const retirementAgeOf = async () => (await db.select({ age: clients.retirementAge }).from(clients).where(eq(clients.id, clientId)))[0].age;
    expect(await retirementAgeOf()).toBe(65);
    const edit = (await run("update_plan_detail", { clientId, sectionId: "people", fixedRow: "Client", cells: { retirementAge: 67 } })) as {
      importId: string;
      saved: { action: string; fields: { key: string; included: boolean }[] }[];
    };
    expect(edit.saved).toMatchObject([{ action: "update", fields: [{ key: "retirementAge", included: true }] }]);
    expect(await retirementAgeOf()).toBe(67);
    expect((await importOf(edit.importId)).status).toBe("committed");

    // Removing a row this test made: gone, and the result names it.
    const salary = salaries[0];
    expect(await run("remove_plan_detail", { clientId, kind: "income", recordId: salary.id })).toMatchObject({
      removed: { kind: "income", recordId: salary.id, label: salary.name },
    });
    expect(await db.select({ id: incomes.id }).from(incomes).where(eq(incomes.id, salary.id))).toEqual([]);

    // The seeded Household Cash can't be removed: the core's own refusal, and the row stays.
    expect(await refusalOf(run("remove_plan_detail", { clientId, kind: "account", recordId: seededCash!.recordId }))).toEqual(
      new McpInputError("This is a system-managed cash account and can't be deleted."),
    );
    expect(await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, seededCash!.recordId))).toHaveLength(1);
  }, 300_000);

  it("refuses a second firm's principal at every step", async () => {
    // The firm's own household, with step 0 still open as a draft; and the other firm's own household.
    const own = await createHousehold(PRINCIPAL, { name: "Laura Check Household", primary: LAURA, filingStatus: "single" });
    const theirs = await createHousehold(OUTSIDER, { name: "Check Household", primary: MARK, filingStatus: "single" });
    const cash = (await accountsOf(own.clientId)).find((a) => a.isDefaultChecking)!;
    const was = await planOf(own.clientId);

    const clientId = own.clientId;
    const row = { sectionId: "family", cells: { firstName: "Emma", relationship: "Child" } };
    const steps: [string, Record<string, unknown>][] = [
      ["create_household", { householdId: own.householdId, prospect: { filingStatus: "single", retirementAge: 63 } }],
      ["start_fact_finder_step", { clientId, step: "balance_sheet" }],
      ["fill_fact_finder_step", { clientId, importId: own.importId, baseVersion: own.version, rows: [row] }],
      ["review_fact_finder_step", { clientId, importId: own.importId }],
      ["save_fact_finder_step", { clientId, importId: own.importId, changeSetVersion: 1 }],
      ["get_missing_facts", { clientId }],
      ["update_plan_detail", { clientId, sectionId: "people", fixedRow: "Client", cells: { retirementAge: 70 } }],
      ["update_plan_assumptions", { clientId, changes: { inflationRate: 0.05 } }],
      ["remove_plan_detail", { clientId, kind: "account", recordId: cash.id }],
    ];
    for (const [name, args] of steps) {
      const err = await refusalOf(run(name, args, OUTSIDER));
      expect(err, name).toBeInstanceOf(McpForbiddenError);
      expect((err as Error).message, name).toBe(CLIENT_UNREADABLE_MESSAGE);
    }

    // Naming its own household with this firm's draft finds no such step.
    const viaOwnClient: [string, Record<string, unknown>][] = [
      ["fill_fact_finder_step", { clientId: theirs.clientId, importId: own.importId, baseVersion: own.version, rows: [row] }],
      ["review_fact_finder_step", { clientId: theirs.clientId, importId: own.importId }],
      ["save_fact_finder_step", { clientId: theirs.clientId, importId: own.importId, changeSetVersion: 1 }],
    ];
    for (const [name, args] of viaOwnClient) {
      expect(await refusalOf(run(name, args, OUTSIDER)), name).toEqual(
        new McpInputError("That fact finder step wasn't found. Use the importId start_fact_finder_step returned."),
      );
    }

    expect(await planOf(own.clientId)).toEqual(was);
  }, 300_000);

  it("names the likely duplicate the live query finds, trimmed and in any case, and creates only when told it differs", async () => {
    const NORA = { firstName: "Nora", lastName: "Dupe", dateOfBirth: "1975-06-01", retirementAge: 65 };
    const first = await createHousehold(PRINCIPAL, { name: "Dupe Household", primary: NORA, filingStatus: "single" });
    const counts = async () => ({
      households: (await db.select({ id: crmHouseholds.id }).from(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM))).length,
      clients: (await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, FIRM))).length,
    });
    const before = await counts();
    const again = { name: "Nora Dupe Household", primary: { ...NORA, firstName: "  nORA ", lastName: "DUPE  " }, filingStatus: "single" };

    expect(await run("create_household", { household: again })).toEqual({
      created: false,
      likelyDuplicate: { householdId: first.householdId, name: "Dupe Household", hasPlan: true, clientId: first.clientId },
    });
    expect(await counts()).toEqual(before);

    const different = (await run("create_household", { household: again, differentFromHouseholdId: first.householdId })) as Created;
    expect(different).toMatchObject({ created: true, clientId: expect.any(String) });
    expect(different.householdId).not.toBe(first.householdId);
    expect(await counts()).toEqual({ households: before.households + 1, clients: before.clients + 1 });
  }, 300_000);
});
