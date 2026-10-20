// src/domain/mcp/__tests__/household-building-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  factFinderGateFor: vi.fn(),
  createFactFinderImport: vi.fn(),
  editFactFinder: vi.fn(),
  loadRecordBook: vi.fn(),
  resolveBaseCaseScenarioId: vi.fn(),
  firmClaudeWritesEnabled: vi.fn(),
  verifyClientAccessFor: vi.fn(),
  recordAudit: vi.fn(),
  reviewFactFinder: vi.fn(),
  saveChangeSet: vi.fn(),
  runLeftovers: vi.fn(),
  withAiCallerOrg: vi.fn(),
  ensurePlanImport: vi.fn(),
  findLikelyDuplicateHousehold: vi.fn(),
  verifyCrmHouseholdAccessFor: vi.fn(),
  discardImport: vi.fn(),
  updatePlanSettingsForClient: vi.fn(),
  loadEffectiveTree: vi.fn(),
  deleteAccountForClient: vi.fn(),
  deleteLiabilityForClient: vi.fn(),
  deleteIncomeForClient: vi.fn(),
  deleteExpenseForClient: vi.fn(),
  deleteSavingsRuleForClient: vi.fn(),
  labelRows: vi.fn(),
}));
const { PlanImportRefusal } = vi.hoisted(() => ({ PlanImportRefusal: class PlanImportRefusal extends Error {} }));

// The real create check (it reads the mocked client access and audit); the import gate is stubbed.
vi.mock("@/lib/fact-finder/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fact-finder/gate")>()),
  factFinderGateFor: h.factFinderGateFor,
}));
vi.mock("@/lib/fact-finder/import-lifecycle", () => ({
  createFactFinderImport: h.createFactFinderImport,
  discardImport: h.discardImport,
}));
vi.mock("@/lib/clients/plan-settings-writes", () => ({ updatePlanSettingsForClient: h.updatePlanSettingsForClient }));
vi.mock("@/lib/clients/accounts-writes", () => ({ deleteAccountForClient: h.deleteAccountForClient }));
vi.mock("@/lib/clients/liabilities-writes", () => ({ deleteLiabilityForClient: h.deleteLiabilityForClient }));
vi.mock("@/lib/clients/incomes-writes", () => ({ deleteIncomeForClient: h.deleteIncomeForClient }));
vi.mock("@/lib/clients/expenses-writes", () => ({ deleteExpenseForClient: h.deleteExpenseForClient }));
vi.mock("@/lib/clients/savings-rules-writes", () => ({ deleteSavingsRuleForClient: h.deleteSavingsRuleForClient }));
// The label read: select(...).from(...)[.leftJoin(...)].where(...) resolves to the rows.
vi.mock("@/db", () => {
  const where = () => h.labelRows();
  return { db: { select: () => ({ from: () => ({ where, leftJoin: () => ({ where }) }) }) } };
});
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: h.loadEffectiveTree }));
vi.mock("@/lib/fact-finder/edit", () => ({ editFactFinder: h.editFactFinder }));
vi.mock("@/lib/fact-finder/records/book", () => ({ loadRecordBook: h.loadRecordBook }));
vi.mock("@/lib/fact-finder/records/load", () => ({ resolveBaseCaseScenarioId: h.resolveBaseCaseScenarioId }));
vi.mock("@/lib/firm-settings", () => ({ firmClaudeWritesEnabled: h.firmClaudeWritesEnabled }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));
vi.mock("@/lib/fact-finder/review", () => ({ reviewFactFinder: h.reviewFactFinder }));
vi.mock("@/lib/fact-finder/save/save", () => ({ saveChangeSet: h.saveChangeSet }));
vi.mock("@/lib/fact-finder/placement/leftovers-run", () => ({ runLeftovers: h.runLeftovers }));
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: h.ensurePlanImport, PlanImportRefusal }));
vi.mock("@/lib/crm/duplicate-household", () => ({ findLikelyDuplicateHousehold: h.findLikelyDuplicateHousehold }));
vi.mock("@/lib/crm/authz", () => ({ verifyCrmHouseholdAccessFor: h.verifyCrmHouseholdAccessFor }));
vi.mock("@/lib/ai/resolve", () => ({ withAiCallerOrg: h.withAiCallerOrg }));

import { householdBuildingTools } from "../tools/household-building";
import { VIEW_ONLY_MESSAGE, WRITE_DISABLED_MESSAGE } from "../define-tool";
import { changeListView } from "../change-list-view";
import { McpInputError } from "../define-tool";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
import { FACT_FINDER_STEP_IDS } from "../fact-finder-steps";
import { SAVE_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import { defaultTicks, type ChangeField, type ChangeLine, type ChangeSet } from "@/lib/fact-finder/change-set";
import { emptyRecordBook, type RecordBook } from "@/lib/fact-finder/placement/types";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { validatePlanSettingsPatch } from "@/lib/plan-settings/validate-patch";

const principal: McpPrincipal = {
  userId: "u1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "u1",
  canWrite: true,
  entitlements: ["ai_import"],
};
const tool = (name: string) => householdBuildingTools.find((t) => t.name === name)!;
const start = tool("start_fact_finder_step");
const fill = tool("fill_fact_finder_step");
const review = tool("review_fact_finder_step");
const save = tool("save_fact_finder_step");
const create = tool("create_household");
const missingFactsTool = tool("get_missing_facts");
const editTool = tool("update_plan_detail");
const assumptionsTool = tool("update_plan_assumptions");
const removeTool = tool("remove_plan_detail");

const BASE = "11111111-1111-4111-8111-111111111111";
const IMPORT = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function seededBook(): RecordBook {
  const b = emptyRecordBook("c1");
  return {
    ...b,
    scenarioId: BASE,
    records: {
      ...b.records,
      account: [
        { id: "acc-cash", label: "Household Cash", values: {}, facts: { category: "cash", isDefaultChecking: true } },
      ],
    },
  };
}

/** The draft as the gate reads it: version 3, one Schwab IRA row. */
function draft(): FactFinderState {
  const state = emptyFactFinderState();
  state.version = 3;
  state.sections.retirement = [
    { id: "row-ira", cells: { accountName: { value: "Schwab IRA", by: "chat", pinned: true } }, sourceFileIds: [] },
  ];
  return state;
}

/** The org withAiCallerOrg is running a call as; null outside one. */
let aiCallerOrg: string | null = null;

function gateAllows(state: FactFinderState = draft()) {
  h.factFinderGateFor.mockResolvedValue({
    ok: true,
    firmId: "org_1",
    userId: "u1",
    clientId: "c1",
    importId: IMPORT,
    imp: {},
    payloadJson: { factFinder: state },
  });
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.firmClaudeWritesEnabled.mockResolvedValue(true);
  h.verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" });
  h.recordAudit.mockResolvedValue(undefined);
  h.verifyCrmHouseholdAccessFor.mockResolvedValue({ ok: true, firmId: "org_1", advisorId: "u1" });
  h.findLikelyDuplicateHousehold.mockResolvedValue(null);
  h.ensurePlanImport.mockResolvedValue({ clientId: "c9", scenarioId: BASE, importId: IMPORT, householdId: "hh9" });
  h.resolveBaseCaseScenarioId.mockResolvedValue(BASE);
  h.loadRecordBook.mockResolvedValue(seededBook());
  h.createFactFinderImport.mockResolvedValue({ id: IMPORT, payloadJson: { factFinder: emptyFactFinderState() } });
  gateAllows();
  // By default the edit lands: the state the ops produced, one version on.
  h.editFactFinder.mockImplementation(async (_scope, current: FactFinderState) => ({
    ok: true,
    state: { ...current, version: current.version + 1 },
  }));
  // The org an AI call inside it runs as, while it runs.
  h.withAiCallerOrg.mockImplementation((orgId: string, fn: () => unknown) => {
    aiCallerOrg = orgId;
    try {
      return fn();
    } finally {
      aiCallerOrg = null;
    }
  });
});

describe("start_fact_finder_step", () => {
  it("creates an updating import on the base case, named for the step, and describes the step", async () => {
    const out = (await start.run({ clientId: "c1", step: "balance_sheet" }, principal)) as Record<string, unknown>;

    expect(h.createFactFinderImport).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      userId: "u1",
      scenarioId: BASE,
      mode: "updating",
      notes: "Claude: Balance sheet",
      audit: { via: "claude" },
    });
    expect(h.loadRecordBook).toHaveBeenCalledWith("c1", "org_1", BASE);
    expect(out.importId).toBe(IMPORT);
    expect(out.version).toBe(0);
    expect(out.step).toMatchObject({ id: "balance_sheet", label: "Balance sheet" });
    expect((out.sections as { id: string }[]).map((s) => s.id)).toContain("retirement");
    expect(out.existingRecords).toEqual([
      { target: "account", recordId: "acc-cash", label: "Household Cash", seeded: true },
    ]);
    expect(out.foundryUrl).toMatch(/\/clients\/c1\//);
  });

  it("audits the import and the step, never anything else", async () => {
    await start.run({ clientId: "c1", step: "income" }, principal);
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.tool_write",
        metadata: { importId: IMPORT, step: "income", tool: "start_fact_finder_step", via: "claude" },
      }),
    );
  });

  it("refuses a household with no base plan, before creating anything", async () => {
    h.resolveBaseCaseScenarioId.mockResolvedValue(null);
    const err = await start.run({ clientId: "c1", step: "household" }, principal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpInputError);
    expect((err as Error).message).toBe("This household has no base plan yet.");
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });

  // R23: the import gate's client and entitlement refusals run before a draft exists.
  it("refuses a shared client before creating anything", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "shared" });
    const err = await start.run({ clientId: "c1", step: "household" }, principal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect((err as Error).message).toBe("Cross-organization imports are not supported.");
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
    expect(h.loadRecordBook).not.toHaveBeenCalled();
  });

  it("refuses a firm without AI import before creating anything, and audits the refusal", async () => {
    const err = await start
      .run({ clientId: "c1", step: "household" }, { ...principal, entitlements: [] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect((err as Error).message).toBe("AI features aren't enabled for this firm.");
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.access_denied",
        clientId: "c1",
        actorId: "u1",
        metadata: { reason: "ai_import_not_entitled", via: "claude" },
      }),
    );
  });

  it("refuses a step that isn't in the catalog at schema parse", async () => {
    await expect(start.run({ clientId: "c1", step: "taxes" }, principal)).rejects.toThrow();
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });
});

describe("fill_fact_finder_step", () => {
  const call = (args: Record<string, unknown>) =>
    fill.run({ clientId: "c1", importId: IMPORT, baseVersion: 3, ...args }, principal);

  it("turns a new row, a fixed row and a clear into the fact finder's ops, written as chat with Claude's sources", async () => {
    await call({
      rows: [
        {
          sectionId: "cash",
          cells: { accountName: "Chase Checking", currentValue: 12500, last4: null },
          link: { recordId: "acc-cash" },
          sources: { currentValue: { document: "Chase statement Sept 2026.pdf", page: 1, quote: "Ending balance $12,500.00" } },
        },
        { sectionId: "people", fixedRow: "Client", cells: { firstName: "Mark", retirementAge: 65 } },
        { sectionId: "retirement", rowId: "row-ira", cells: { last4: null } },
      ],
    });

    expect(h.factFinderGateFor).toHaveBeenCalledWith(principal, "c1", IMPORT, "edit");
    const [scope, current, baseVersion, ops, ctx] = h.editFactFinder.mock.calls[0];
    expect(scope).toEqual({ importId: IMPORT, clientId: "c1", firmId: "org_1" });
    expect(current.version).toBe(3);
    expect(baseVersion).toBe(3);

    const newRowId = ops[0].rowId as string;
    expect(newRowId).toMatch(UUID);
    expect(ops).toEqual([
      { op: "addRow", sectionId: "cash", rowId: newRowId, cells: { accountName: "Chase Checking", currentValue: 12500 } },
      { op: "setLink", sectionId: "cash", rowId: newRowId, link: { kind: "existing", recordId: "acc-cash" } },
      { op: "setCell", sectionId: "people", rowId: "people:Client", columnId: "firstName", value: "Mark" },
      { op: "setCell", sectionId: "people", rowId: "people:Client", columnId: "retirementAge", value: 65 },
      { op: "clearCell", sectionId: "retirement", rowId: "row-ira", columnId: "last4" },
    ]);
    expect(ctx).toEqual({
      by: "chat",
      actorId: "u1",
      stamps: [
        {
          sectionId: "cash",
          rowId: newRowId,
          columnId: "currentValue",
          documentName: "Chase statement Sept 2026.pdf",
          page: 1,
          quote: "Ending balance $12,500.00",
        },
      ],
    });
  });

  // R17: stampSources cites ANY non-blank cell it is pointed at, so a source
  // must only ever be built for a value this call writes.
  it("cites only cells the same row sets to a value — never one it clears or leaves alone", async () => {
    await call({
      rows: [
        {
          sectionId: "retirement",
          rowId: "row-ira",
          cells: { currentValue: 380000, last4: null },
          sources: {
            currentValue: { document: "Schwab Q3.pdf" },
            last4: { document: "Schwab Q3.pdf" },
            accountName: { document: "Schwab Q3.pdf" },
          },
        },
      ],
    });
    const ctx = h.editFactFinder.mock.calls[0][4];
    expect(ctx.stamps).toEqual([
      { sectionId: "retirement", rowId: "row-ira", columnId: "currentValue", documentName: "Schwab Q3.pdf" },
    ]);
  });

  it("removes rows with Claude named as the reason, and records a link decision as new", async () => {
    const state = draft();
    state.sections.cash = [
      { id: "row-old", cells: { accountName: { value: "Old checking", by: "document" } }, sourceFileIds: ["f1"] },
    ];
    gateAllows(state);
    await call({
      rows: [{ sectionId: "retirement", rowId: "row-ira", cells: {}, link: "new" }],
      removeRowIds: ["row-old"],
    });
    expect(h.editFactFinder.mock.calls[0][3]).toEqual([
      { op: "setLink", sectionId: "retirement", rowId: "row-ira", link: { kind: "new" } },
      { op: "removeRow", sectionId: "cash", rowId: "row-old", reason: "Removed by Claude" },
    ]);
  });

  it("returns the new version, the touched sections' rows, and the rows that need the advisor's decision", async () => {
    const after = draft();
    after.version = 4;
    after.sections.retirement = [
      {
        id: "row-ira",
        cells: { accountName: { value: "Schwab IRA", by: "chat", pinned: true } },
        link: { kind: "existing", recordId: "acc-ira", score: 0.74, confirmed: false, by: "auto" },
        linkCandidates: [{ recordId: "acc-ira", label: "Schwab Rollover IRA", score: 0.74 }],
        sourceFileIds: [],
      },
    ];
    h.editFactFinder.mockResolvedValue({ ok: true, state: after });

    const out = await call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: { currentValue: 380000 } }] });

    expect(out).toEqual({
      version: 4,
      rows: [
        {
          sectionId: "retirement",
          rowId: "row-ira",
          cells: { accountName: "Schwab IRA" },
          link: { recordId: "acc-ira", score: 0.74, confirmed: false },
        },
      ],
      needsDecision: [
        {
          sectionId: "retirement",
          rowId: "row-ira",
          label: "Schwab IRA",
          candidates: [{ recordId: "acc-ira", label: "Schwab Rollover IRA", score: 0.74 }],
        },
      ],
    });
  });

  it("answers a stale baseVersion with the current rows to re-apply against, and writes nothing", async () => {
    const fresh = draft();
    fresh.version = 7;
    fresh.sections.retirement[0].cells.currentValue = { value: 400000, by: "advisor", pinned: true };
    h.editFactFinder.mockResolvedValue({ ok: false, status: 409, error: "conflict", factFinder: fresh });

    const err = await call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: { currentValue: 380000 } }] }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(McpInputError);
    expect((err as McpInputError).message).toBe(
      "Someone else changed this step. Here is the current version; re-apply your changes to it.",
    );
    expect((err as McpInputError).details).toEqual({
      version: 7,
      rows: [
        { sectionId: "retirement", rowId: "row-ira", cells: { accountName: "Schwab IRA", currentValue: 400000 }, link: null },
      ],
    });
    expect(h.editFactFinder).toHaveBeenCalledTimes(1);
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  // The version check runs before the ops are validated, so a stale fill can
  // name a section the fact finder doesn't have: still the conflict, not a crash.
  it("still answers a stale fill with the conflict when it also names an unknown section", async () => {
    h.editFactFinder.mockResolvedValue({ ok: false, status: 409, error: "conflict", factFinder: draft() });
    const err = await call({ rows: [{ sectionId: "nope", cells: { x: 1 } }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpInputError);
    expect((err as McpInputError).message).toMatch(/^Someone else changed this step/);
    expect((err as McpInputError).details).toEqual({ version: 3, rows: [] });
  });

  it("passes a value the fact finder refuses back as the core's own message", async () => {
    h.editFactFinder.mockResolvedValue({
      ok: false,
      status: 400,
      error: '"lots" isn\'t a valid Current value (a dollar amount).',
    });
    await expect(
      call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: { currentValue: "lots" } }] }),
    ).rejects.toThrow(new McpInputError('"lots" isn\'t a valid Current value (a dollar amount).'));
  });

  it("refuses a row it can't place, a removal of a row the draft doesn't have, and a call that writes nothing", async () => {
    await expect(call({ rows: [{ sectionId: "people", fixedRow: "Partner", cells: { firstName: "x" } }] })).rejects.toThrow(
      'Section people has no fixed row "Partner". Its fixed rows: "Client", "Co-client".',
    );
    await expect(
      call({ rows: [{ sectionId: "people", rowId: "people:Client", fixedRow: "Client", cells: { firstName: "x" } }] }),
    ).rejects.toThrow("Give a row a rowId or a fixedRow, not both.");
    await expect(
      call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: { last4: "1234" } }], removeRowIds: ["nope"] }),
    ).rejects.toThrow("Row nope isn't in this draft.");
    await expect(call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: {} }] })).rejects.toThrow(
      "Nothing to write: give a row cells or a link.",
    );
    expect(h.editFactFinder).not.toHaveBeenCalled();
  });

  it("maps the gate's refusals the way start does: access refusals forbidden, the rest a sentence to act on", async () => {
    const refusedWith = async (status: number, error: string) => {
      h.factFinderGateFor.mockResolvedValueOnce({ ok: false, status, body: { error } });
      return call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: {}, link: "new" }] }).catch((e: unknown) => e);
    };
    const entitlement = await refusedWith(403, "ai_import_not_entitled");
    expect(entitlement).toBeInstanceOf(McpForbiddenError);
    expect((entitlement as Error).message).toBe("AI features aren't enabled for this firm.");
    const share = await refusedWith(403, "Cross-organization imports are not supported.");
    expect(share).toBeInstanceOf(McpForbiddenError);
    const client = await refusedWith(404, "Not found");
    expect(client).toEqual(new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE));
    // Another advisor's import and a missing one read the same, so nothing is
    // disclosed — but only the missing one is a typo; the other is audited as forbidden.
    const notFound = "That fact finder step wasn't found. Use the importId start_fact_finder_step returned.";
    expect(await refusedWith(404, "Import not found")).toEqual(new McpInputError(notFound));
    const othersImport = await refusedWith(403, "Forbidden");
    expect(othersImport).toBeInstanceOf(McpForbiddenError);
    expect((othersImport as Error).message).toBe(notFound);
    const closed = await refusedWith(409, "This import is saved to the plan — start a new import to change it.");
    expect(closed).toEqual(new McpInputError("This import is saved to the plan — start a new import to change it."));
    expect(h.editFactFinder).not.toHaveBeenCalled();
  });

  it("audits the import and the row count, never a cell value", async () => {
    await call({ rows: [{ sectionId: "retirement", rowId: "row-ira", cells: { currentValue: 380000 } }] });
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ importId: IMPORT, rowCount: 1, tool: "fill_fact_finder_step", via: "claude" });
  });

  it("takes at most 50 rows", async () => {
    const rows = Array.from({ length: 51 }, () => ({ sectionId: "cash", cells: { accountName: "x" } }));
    await expect(call({ rows })).rejects.toThrow();
    expect(h.factFinderGateFor).not.toHaveBeenCalled();
  });
});

const changeField = (key: string, ticked: boolean): ChangeField => ({
  key,
  label: key,
  next: key,
  shown: { next: key },
  ticked,
  from: [],
});

function changeLine(id: string, action: ChangeLine["action"], fields: ChangeField[], extra: Partial<ChangeLine> = {}): ChangeLine {
  return {
    id,
    page: "accounts",
    sectionId: "retirement",
    rowId: `row-${id}`,
    target: "account",
    action,
    recordId: action === "create" ? null : `rec-${id}`,
    label: `Account ${id}`,
    fields,
    warnings: [],
    ...extra,
  };
}

/** L1 updates a record (its name starts left out), L2 creates one, L3 can't save, L4 changes nothing. */
function reviewed(): ChangeSet {
  return {
    builtAtVersion: 4,
    builtAt: "2026-10-19T12:00:00.000Z",
    lines: [
      changeLine("L1", "update", [changeField("name", false), changeField("value", true)]),
      changeLine("L2", "create", [changeField("name", true), changeField("value", true), changeField("growthRate", true)]),
      changeLine("L3", "create", [changeField("name", true)], { blocked: { reason: "Pick who the 529 is for." } }),
      changeLine("L4", "none", []),
    ],
    notices: [],
  };
}

describe("review_fact_finder_step", () => {
  const call = () => review.run({ clientId: "c1", importId: IMPORT }, principal);

  it("builds the change list the screen's review builds, its AI step in the caller's org, and shows it with the default ticks", async () => {
    const changeSet = reviewed();
    let reviewedAs: string | null = null;
    h.reviewFactFinder.mockImplementation(async () => {
      reviewedAs = aiCallerOrg;
      return { ok: true, changeSet, factFinder: { ...draft(), version: 4, changeSet } };
    });

    const out = (await call()) as Record<string, unknown>;

    expect(h.factFinderGateFor).toHaveBeenCalledWith(principal, "c1", IMPORT, "match");
    expect(h.withAiCallerOrg).toHaveBeenCalledWith("org_1", expect.any(Function));
    expect(reviewedAs).toBe("org_1");
    const [scope, state, opts] = h.reviewFactFinder.mock.calls[0];
    expect(scope).toEqual({ importId: IMPORT, clientId: "c1", firmId: "org_1" });
    expect(state.version).toBe(3);
    expect(opts).toEqual({ now: expect.any(Date), actorId: "u1", runLeftovers: h.runLeftovers });
    expect(out).toEqual(changeListView(changeSet, defaultTicks(changeSet)));
  });

  it("audits the import and the change list's version, never its contents", async () => {
    const changeSet = reviewed();
    h.reviewFactFinder.mockResolvedValue({ ok: true, changeSet, factFinder: { ...draft(), version: 4, changeSet } });
    await call();
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ importId: IMPORT, changeSetVersion: 4, tool: "review_fact_finder_step", via: "claude" });
  });

  it("answers a link waiting on the advisor with the review's own message and the rows that need the decision", async () => {
    const state = draft();
    state.sections.retirement[0].link = { kind: "existing", recordId: "acc-ira", score: 0.74, confirmed: false, by: "auto" };
    state.sections.retirement[0].linkCandidates = [{ recordId: "acc-ira", label: "Schwab Rollover IRA", score: 0.74 }];
    gateAllows(state);
    h.reviewFactFinder.mockResolvedValue({ ok: false, status: 409, body: { error: "1 link needs a click first." } });

    const err = await call().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpInputError);
    expect((err as McpInputError).message).toBe("1 link needs a click first.");
    expect((err as McpInputError).details).toEqual({
      needsDecision: [
        {
          sectionId: "retirement",
          rowId: "row-ira",
          label: "Schwab IRA",
          candidates: [{ recordId: "acc-ira", label: "Schwab Rollover IRA", score: 0.74 }],
        },
      ],
    });
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("answers a refusal that names rows with those rows, from the draft as the review left it", async () => {
    const after = draft();
    after.version = 4;
    after.sections.retirement[0].linkCandidates = [{ recordId: "acc-roth", label: "Roth IRA", score: 0.5 }];
    const error = '1 link pointed at a record that\'s no longer on the plan — "Schwab IRA". Check it and review again.';
    h.reviewFactFinder.mockResolvedValue({ ok: false, status: 409, body: { error, factFinder: after, rows: ["row-ira"] } });

    const err = await call().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpInputError);
    expect((err as McpInputError).message).toBe(error);
    expect((err as McpInputError).details).toEqual({
      version: 4,
      needsDecision: [
        { sectionId: "retirement", rowId: "row-ira", label: "Schwab IRA", candidates: [{ recordId: "acc-roth", label: "Roth IRA", score: 0.5 }] },
      ],
    });
  });

  it("answers a refusal with nothing to look at with its message alone", async () => {
    h.reviewFactFinder.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "Wait for the documents to finish reading, then review." },
    });
    const err = await call().catch((e: unknown) => e);
    expect(err).toEqual(new McpInputError("Wait for the documents to finish reading, then review."));
    expect((err as McpInputError).details).toBeUndefined();
  });

  it("refuses an import already saved before reviewing it", async () => {
    h.factFinderGateFor.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: "This import is saved to the plan — start a new import to change it." },
    });
    await expect(call()).rejects.toThrow(new McpInputError("This import is saved to the plan — start a new import to change it."));
    expect(h.reviewFactFinder).not.toHaveBeenCalled();
  });
});

describe("save_fact_finder_step", () => {
  const call = (args: Record<string, unknown> = {}) =>
    save.run({ clientId: "c1", importId: IMPORT, changeSetVersion: 4, ...args }, principal);

  beforeEach(() => {
    gateAllows({ ...draft(), version: 4, changeSet: reviewed() });
    h.saveChangeSet.mockResolvedValue({
      ok: true,
      factFinder: {
        ...draft(),
        version: 5,
        closed: {
          at: "2026-10-19T12:05:00.000Z",
          by: "u1",
          saved: [
            { lineId: "L1", rowId: "row-L1", target: "account", recordId: "rec-L1", label: "Account L1" },
            { lineId: "L2", rowId: "row-L2", target: "account", recordId: "acc-new", label: "Account L2" },
          ],
          leftOut: [{ lineId: "L3", rowId: "row-L3", label: "Account L3", reason: "Pick who the 529 is for." }],
        },
      },
    });
  });

  const ticksSent = () => h.saveChangeSet.mock.calls[0][0].ticks;

  it("saves the reviewed list with its default ticks, as the advisor, through the principal's access", async () => {
    const out = await call();

    expect(h.factFinderGateFor).toHaveBeenCalledWith(principal, "c1", IMPORT, "commit");
    expect(h.saveChangeSet).toHaveBeenCalledWith({
      scope: { importId: IMPORT, clientId: "c1", firmId: "org_1" },
      actorId: "u1",
      principal,
      changeSetVersion: 4,
      ticks: defaultTicks(reviewed()),
    });
    expect(out).toEqual({
      saved: { create: 1, update: 1 },
      leftOut: [{ lineId: "L3", label: "Account L3", reason: "Pick who the 529 is for." }],
      foundryUrl: expect.stringMatching(/\/clients\/c1\//),
    });
  });

  it("leaves out a whole line, or one field of a line", async () => {
    await call({ leaveOut: [{ lineId: "L2" }, { lineId: "L1", key: "value" }] });
    expect(ticksSent()).toEqual({
      L1: { name: false, value: false },
      L2: { name: false, value: false, growthRate: false },
    });
  });

  it("includes a field the review left out by default", async () => {
    await call({ include: [{ lineId: "L1", key: "name" }] });
    expect(ticksSent().L1).toEqual({ name: true, value: true });
  });

  it("takes a line that can't save as already left out", async () => {
    await call({ leaveOut: [{ lineId: "L3" }] });
    expect(ticksSent()).toEqual(defaultTicks(reviewed()));
  });

  // R27: a tick the change list can't take refuses — never one quietly dropped.
  it("refuses a line or field the change list doesn't have, and including a line that can't save, before anything saves", async () => {
    await expect(call({ leaveOut: [{ lineId: "L9" }] })).rejects.toThrow(
      new McpInputError("Line L9 isn't in this change list. Use a lineId review_fact_finder_step returned."),
    );
    await expect(call({ leaveOut: [{ lineId: "L1", key: "owners" }] })).rejects.toThrow(
      new McpInputError('Line L1 has no field "owners".'),
    );
    await expect(call({ include: [{ lineId: "L9", key: "name" }] })).rejects.toThrow(
      new McpInputError("Line L9 isn't in this change list. Use a lineId review_fact_finder_step returned."),
    );
    await expect(call({ include: [{ lineId: "L3", key: "name" }] })).rejects.toThrow(
      new McpInputError("Account L3 can't save: Pick who the 529 is for."),
    );
    expect(h.saveChangeSet).not.toHaveBeenCalled();
  });

  it("refuses a change list reviewed again since, or never reviewed, in the save's own words", async () => {
    await expect(call({ changeSetVersion: 3 })).rejects.toThrow(new McpInputError(SAVE_STALE_MESSAGE));
    gateAllows(draft());
    await expect(call()).rejects.toThrow(new McpInputError(SAVE_STALE_MESSAGE));
    expect(h.saveChangeSet).not.toHaveBeenCalled();
  });

  it("passes the stale check's refusal back with the line it names", async () => {
    h.saveChangeSet.mockResolvedValue({
      ok: false,
      status: 409,
      error: "“Account L1” changed since you reviewed — review again.",
      lineId: "L1",
    });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpInputError);
    expect((err as McpInputError).message).toBe("“Account L1” changed since you reviewed — review again.");
    expect((err as McpInputError).details).toEqual({ lineId: "L1" });
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("passes a refusal that names no line back alone", async () => {
    h.saveChangeSet.mockResolvedValue({ ok: false, status: 409, error: "There's nothing to save — every row is unticked or left out." });
    const err = await call().catch((e: unknown) => e);
    expect(err).toEqual(new McpInputError("There's nothing to save — every row is unticked or left out."));
    expect((err as McpInputError).details).toBeUndefined();
  });

  it("audits the import and the change list's version, never a value", async () => {
    await call({ leaveOut: [{ lineId: "L2" }] });
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ importId: IMPORT, changeSetVersion: 4, tool: "save_fact_finder_step", via: "claude" });
  });
});

describe("create_household", () => {
  const primary = { firstName: "Ada", lastName: "Quill", dateOfBirth: "1970-02-03", retirementAge: 65 };
  const spouse = { firstName: "Ben", lastName: "Quill", dateOfBirth: "1972-04-05", retirementAge: 63 };
  const newHousehold = { name: "Quill Household", state: "CA", primary, spouse, filingStatus: "married_joint" };

  it("creates a household and its plan with the exact core arguments, life expectancy 95 for both", async () => {
    const out = await create.run({ household: newHousehold }, principal);

    expect(h.ensurePlanImport).toHaveBeenCalledWith({
      mode: "new",
      firmId: "org_1",
      actorUserId: "u1",
      principal,
      label: "Claude: Household",
      newHousehold: {
        householdName: "Quill Household",
        state: "CA",
        primary: { firstName: "Ada", lastName: "Quill", dateOfBirth: "1970-02-03" },
        spouse: { firstName: "Ben", lastName: "Quill", dateOfBirth: "1972-04-05" },
        filingStatus: "married_joint",
        retirementAge: 65,
        lifeExpectancy: 95,
        spouseRetirementAge: 63,
        spouseLifeExpectancy: 95,
      },
    });
    expect(out).toMatchObject({ created: true, clientId: "c9", householdId: "hh9", importId: IMPORT, nextStep: "household" });
  });

  // Step 0's draft comes back with the household, so Claude never opens a second one for it.
  it("returns step 0's draft as start_fact_finder_step shows a step, read from the new plan's book", async () => {
    const out = await create.run({ household: newHousehold }, principal);
    expect(h.loadRecordBook).toHaveBeenCalledWith("c9", "org_1", BASE);

    const started = (await start.run({ clientId: "c9", step: "household" }, principal)) as Record<string, unknown>;
    expect(started.version).toBe(0);
    expect(out).toEqual({ created: true, clientId: "c9", householdId: "hh9", nextStep: "household", ...started });
  });

  it("links to the new household's plan", async () => {
    const out = (await create.run({ household: newHousehold }, principal)) as { foundryUrl: string };
    expect(out.foundryUrl).toMatch(/\/clients\/c9\/details\/net-worth$/);
  });

  // R47: a state the plan can't hold is refused, never dropped while Claude believes it was set.
  it("refuses a state that isn't a USPS code before checking for duplicates or creating anything", async () => {
    await expect(create.run({ household: { ...newHousehold, state: "Colorado" } }, principal)).rejects.toThrow(
      new McpInputError('"Colorado" isn\'t a USPS state code. Give the two-letter code, e.g. "CO".'),
    );
    expect(h.findLikelyDuplicateHousehold).not.toHaveBeenCalled();
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });

  it("audits the mode and the household, and records the client", async () => {
    await create.run({ household: newHousehold }, principal);
    const row = h.recordAudit.mock.calls.map((c) => c[0]).find((a) => a.action === "mcp.tool_write");
    expect(row.metadata).toMatchObject({ mode: "new", householdId: "hh9", tool: "create_household" });
    expect(row.clientId).toBe("c9");
  });

  it("returns a visible duplicate and creates nothing", async () => {
    h.findLikelyDuplicateHousehold.mockResolvedValue({ householdId: "hh-dup", name: "Quill Household", clientId: null });
    const out = await create.run({ household: newHousehold }, principal);

    expect(h.findLikelyDuplicateHousehold).toHaveBeenCalledWith(principal, newHousehold.primary);
    expect(out).toEqual({
      created: false,
      likelyDuplicate: { householdId: "hh-dup", name: "Quill Household", hasPlan: false, clientId: null },
    });
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });

  it("says a duplicate has a plan when it has a planning client", async () => {
    h.findLikelyDuplicateHousehold.mockResolvedValue({ householdId: "hh-dup", name: "Q", clientId: "c5" });
    const out = (await create.run({ household: newHousehold }, principal)) as { likelyDuplicate: unknown };
    expect(out.likelyDuplicate).toMatchObject({ hasPlan: true, clientId: "c5" });
  });

  it("creates when differentFromHouseholdId names that duplicate", async () => {
    h.findLikelyDuplicateHousehold.mockResolvedValue({ householdId: "hh-dup", name: "Q", clientId: null });
    const out = await create.run({ household: newHousehold, differentFromHouseholdId: "hh-dup" }, principal);
    expect(h.ensurePlanImport).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ created: true });
  });

  it("still returns the duplicate when differentFromHouseholdId names another household", async () => {
    h.findLikelyDuplicateHousehold.mockResolvedValue({ householdId: "hh-dup", name: "Q", clientId: null });
    const out = await create.run({ household: newHousehold, differentFromHouseholdId: "hh-other" }, principal);
    expect(out).toMatchObject({ created: false });
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });

  it("starts a prospect's plan after the household access check, with the retirement ages and 95", async () => {
    const out = await create.run(
      { householdId: "hh9", prospect: { filingStatus: "single", retirementAge: 66 } },
      principal,
    );
    expect(h.verifyCrmHouseholdAccessFor).toHaveBeenCalledWith(principal, "hh9");
    expect(h.findLikelyDuplicateHousehold).not.toHaveBeenCalled();
    expect(h.ensurePlanImport).toHaveBeenCalledWith({
      mode: "prospect",
      firmId: "org_1",
      actorUserId: "u1",
      principal,
      label: "Claude: Household",
      prospect: { householdId: "hh9", filingStatus: "single", retirementAge: 66, lifeExpectancy: 95 },
    });
    expect(out).toMatchObject({ created: true, clientId: "c9", householdId: "hh9", importId: IMPORT, version: 0, nextStep: "household" });
    expect(out).toMatchObject({ step: { id: "household" }, foundryUrl: expect.stringMatching(/\/clients\/c9\//) });
  });

  it("passes the spouse's retirement age for a prospect", async () => {
    await create.run(
      { householdId: "hh9", prospect: { filingStatus: "married_joint", retirementAge: 66, spouseRetirementAge: 64 } },
      principal,
    );
    expect(h.ensurePlanImport.mock.calls[0][0].prospect).toMatchObject({ spouseRetirementAge: 64, spouseLifeExpectancy: 95 });
  });

  it("answers the core's retirement-age refusal as an input error", async () => {
    h.ensurePlanImport.mockRejectedValue(new PlanImportRefusal("Ben's retirement age is required."));
    await expect(
      create.run({ householdId: "hh9", prospect: { filingStatus: "married_joint", retirementAge: 66 } }, principal),
    ).rejects.toThrow(McpInputError);
  });

  it("refuses a household the caller can't see, creating nothing", async () => {
    h.verifyCrmHouseholdAccessFor.mockResolvedValue({ ok: false });
    await expect(
      create.run({ householdId: "hh9", prospect: { filingStatus: "single", retirementAge: 66 } }, principal),
    ).rejects.toThrow(McpForbiddenError);
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });

  it("refuses a firm without AI import before creating anything, and audits the denial", async () => {
    const noAi = { ...principal, entitlements: [] };
    await expect(create.run({ household: newHousehold }, noAi)).rejects.toThrow("AI features aren't enabled for this firm.");
    expect(h.findLikelyDuplicateHousehold).not.toHaveBeenCalled();
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.access_denied", firmId: "org_1", actorId: "u1" }),
    );
  });

  it("fails the schema for householdId with household, or either without its partner", async () => {
    const prospect = { filingStatus: "single", retirementAge: 66 };
    await expect(create.run({ householdId: "hh9", prospect, household: newHousehold }, principal)).rejects.toThrow();
    await expect(create.run({ householdId: "hh9" }, principal)).rejects.toThrow();
    await expect(create.run({ prospect }, principal)).rejects.toThrow();
    await expect(create.run({}, principal)).rejects.toThrow();
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });

  it("requires a spouse's retirement age", async () => {
    const noAge = { firstName: spouse.firstName, lastName: spouse.lastName, dateOfBirth: spouse.dateOfBirth };
    await expect(create.run({ household: { ...newHousehold, spouse: noAge } }, principal)).rejects.toThrow();
  });

  it("refuses while the firm's switch is off", async () => {
    h.firmClaudeWritesEnabled.mockResolvedValue(false);
    await expect(create.run({ household: newHousehold }, principal)).rejects.toThrow(WRITE_DISABLED_MESSAGE);
    expect(h.ensurePlanImport).not.toHaveBeenCalled();
  });
});

describe("get_missing_facts", () => {
  /** An empty plan: no living expenses, so exactly one gap, under living_expenses. */
  const emptyPlan = () => ({ ...emptyRecordBook("c1"), scenarioId: BASE });

  it("reads the base case's book and lists what is missing with a count for every step", async () => {
    h.loadRecordBook.mockResolvedValue(emptyPlan());
    const out = (await missingFactsTool.run({ clientId: "c1" }, principal)) as {
      missing: { step: string; missing: string }[];
      byStep: Record<string, number>;
      foundryUrl: string;
    };
    expect(h.loadRecordBook).toHaveBeenCalledWith("c1", "org_1", BASE);
    expect(out.missing).toMatchObject([{ step: "living_expenses", missing: "current living expenses" }]);
    expect(Object.keys(out.byStep)).toEqual(FACT_FINDER_STEP_IDS);
    expect(out.byStep.living_expenses).toBe(1);
    expect(out.byStep.estate).toBe(0);
    expect(out.foundryUrl).toMatch(/\/clients\/c1\//);
  });

  it("filters the list to one step but still counts the whole household", async () => {
    const book = emptyPlan();
    book.records.family_member = [{ id: "fm1", label: "Jo Rivera", values: { dateOfBirth: null } }];
    h.loadRecordBook.mockResolvedValue(book);
    const out = (await missingFactsTool.run({ clientId: "c1", step: "household" }, principal)) as {
      missing: unknown[];
      byStep: Record<string, number>;
    };
    expect(out.missing).toEqual([
      { step: "household", target: "family_member", recordId: "fm1", label: "Jo Rivera", missing: "date of birth" },
    ]);
    expect(out.byStep.household).toBe(1);
    expect(out.byStep.living_expenses).toBe(1);
  });

  it("refuses a household with no base plan", async () => {
    h.resolveBaseCaseScenarioId.mockResolvedValue(null);
    const err = await missingFactsTool.run({ clientId: "c1" }, principal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpInputError);
    expect((err as Error).message).toBe("This household has no base plan yet.");
  });

  it("is a read: needs neither the write switch nor AI import, and creates nothing", async () => {
    h.firmClaudeWritesEnabled.mockResolvedValue(false);
    h.loadRecordBook.mockResolvedValue(emptyPlan());
    await missingFactsTool.run({ clientId: "c1" }, { ...principal, canWrite: false, entitlements: [] });
    expect(missingFactsTool.annotations.readOnlyHint).toBe(true);
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });

  it("refuses a client the caller can't read", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false });
    const err = await missingFactsTool.run({ clientId: "c1" }, principal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect(h.loadRecordBook).not.toHaveBeenCalled();
  });
});

describe("update_plan_detail", () => {
  const call = (args: Record<string, unknown>) => editTool.run({ clientId: "c1", ...args }, principal);
  const SCOPE = { importId: IMPORT, clientId: "c1", firmId: "org_1" };

  /** The row the edit added (or the fixed row it set): the first op names it. */
  const editedRowId = () => h.editFactFinder.mock.calls[0][3][0].rowId as string;

  /** The edited row's account line: its name starts left out, as a name that would replace one on record does. */
  function accountLine(rowId: string, extra: Partial<ChangeLine> = {}): ChangeLine {
    const field = (key: string, columnId: string, ticked: boolean): ChangeField => ({
      key,
      label: key,
      next: key,
      shown: { next: `new ${key}`, onRecord: `old ${key}` },
      ticked,
      from: [{ sectionId: "retirement", rowId, columnId }],
    });
    return changeLine(`${rowId}/account`, "update", [field("name", "accountName", false), field("value", "currentValue", true)], {
      rowId,
      recordId: "acc-ira",
      label: "Schwab IRA",
      ...extra,
    });
  }

  /** The review builds the edited row's lines (made by `lines`) at the draft's next version. */
  function reviewBuilds(lines: (rowId: string) => ChangeLine[]) {
    h.reviewFactFinder.mockImplementation(async (_scope, state: FactFinderState) => {
      const changeSet: ChangeSet = { builtAtVersion: state.version + 1, builtAt: "2026-10-19T12:00:00.000Z", lines: lines(editedRowId()), notices: [] };
      return { ok: true, changeSet, factFinder: { ...state, version: state.version + 1, changeSet } };
    });
  }

  function saveCloses(leftOut: { lineId: string; rowId: string; label: string; reason: string }[] = []) {
    h.saveChangeSet.mockImplementation(async () => {
      const rowId = editedRowId();
      return {
        ok: true,
        factFinder: {
          ...emptyFactFinderState(),
          closed: {
            at: "2026-10-19T12:05:00.000Z",
            by: "u1",
            saved: [{ lineId: `${rowId}/account`, rowId, target: "account", recordId: "acc-ira", label: "Schwab IRA" }],
            leftOut,
          },
        },
      };
    });
  }

  beforeEach(() => {
    gateAllows(emptyFactFinderState());
    h.discardImport.mockResolvedValue("discarded");
    reviewBuilds((rowId) => [accountLine(rowId)]);
    saveCloses();
  });

  it("turns a recordId edit into a new row linked to that record, and saves every field it sets, name included", async () => {
    const out = (await call({
      sectionId: "retirement",
      recordId: "acc-ira",
      cells: { accountName: "Schwab Rollover IRA", currentValue: 412000 },
      sources: { currentValue: { document: "Schwab Q3.pdf", page: 2 }, last4: { document: "Schwab Q3.pdf" } },
    })) as Record<string, unknown>;

    expect(h.createFactFinderImport).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      userId: "u1",
      scenarioId: BASE,
      mode: "updating",
      notes: "Claude edit: Retirement Accounts",
      audit: { via: "claude" },
    });
    expect(h.factFinderGateFor).toHaveBeenCalledWith(principal, "c1", IMPORT, "commit");

    const rowId = editedRowId();
    expect(rowId).toMatch(UUID);
    const [scope, , baseVersion, ops, ctx] = h.editFactFinder.mock.calls[0];
    expect(scope).toEqual(SCOPE);
    expect(baseVersion).toBe(0);
    expect(ops).toEqual([
      { op: "addRow", sectionId: "retirement", rowId, cells: { accountName: "Schwab Rollover IRA", currentValue: 412000 } },
      { op: "setLink", sectionId: "retirement", rowId, link: { kind: "existing", recordId: "acc-ira" } },
    ]);
    // R17: a source only for a cell this edit sets.
    expect(ctx).toEqual({
      by: "chat",
      actorId: "u1",
      stamps: [{ sectionId: "retirement", rowId, columnId: "currentValue", documentName: "Schwab Q3.pdf", page: 2 }],
    });

    // R19: no AI step for a single edit.
    expect(h.reviewFactFinder.mock.calls[0][2]).toEqual({ now: expect.any(Date), actorId: "u1", runLeftovers: null });
    expect(h.withAiCallerOrg).not.toHaveBeenCalled();

    expect(h.saveChangeSet).toHaveBeenCalledWith({
      scope: SCOPE,
      actorId: "u1",
      principal,
      // The edit moved the draft to version 1, and the review to 2.
      changeSetVersion: 2,
      ticks: { [`${rowId}/account`]: { name: true, value: true } },
    });
    expect(h.discardImport).not.toHaveBeenCalled();
    expect(out).toEqual({
      importId: IMPORT,
      saved: [
        {
          lineId: `${rowId}/account`,
          action: "update",
          what: "Account",
          label: "Schwab IRA",
          fields: [
            { key: "name", label: "name", from: "old name", to: "new name", included: true },
            { key: "value", label: "value", from: "old value", to: "new value", included: true },
          ],
        },
      ],
      foundryUrl: expect.stringMatching(/\/clients\/c1\//),
    });
  });

  it("leaves a field the edit doesn't set at the review's default", async () => {
    await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 412000 } });
    expect(h.saveChangeSet.mock.calls[0][0].ticks).toEqual({ [`${editedRowId()}/account`]: { name: false, value: true } });
  });

  it("sets a fixed row's cells in place, links it to a recordId when given, and links a new row as new", async () => {
    await call({ sectionId: "people", fixedRow: "Client", cells: { retirementAge: 63 } });
    expect(h.editFactFinder.mock.calls[0][3]).toEqual([
      { op: "setCell", sectionId: "people", rowId: "people:Client", columnId: "retirementAge", value: 63 },
    ]);
    expect(h.createFactFinderImport.mock.calls[0][0].notes).toBe("Claude edit: Client & Co-client");

    // How a fixed row that needs a decision is answered: the record it is.
    h.editFactFinder.mockClear();
    await call({ sectionId: "salary", fixedRow: "Client", recordId: "inc-1", cells: { annualSalary: 150000 } });
    expect(h.editFactFinder.mock.calls[0][3]).toEqual([
      { op: "setCell", sectionId: "salary", rowId: "salary:Client", columnId: "annualSalary", value: 150000 },
      { op: "setLink", sectionId: "salary", rowId: "salary:Client", link: { kind: "existing", recordId: "inc-1" } },
    ]);

    h.editFactFinder.mockClear();
    await call({ sectionId: "cash", cells: { accountName: "Chase Checking", currentValue: 5000 } });
    const ops = h.editFactFinder.mock.calls[0][3];
    expect(ops).toEqual([
      { op: "addRow", sectionId: "cash", rowId: ops[0].rowId, cells: { accountName: "Chase Checking", currentValue: 5000 } },
      { op: "setLink", sectionId: "cash", rowId: ops[0].rowId, link: { kind: "new" } },
    ]);
  });

  it("audits the import, the section and the lines saved, never a value", async () => {
    await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 412000 } });
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ importId: IMPORT, sectionId: "retirement", saved: 1, tool: "update_plan_detail", via: "claude" });
  });

  it("names a line the save left out, and why, without refusing", async () => {
    saveCloses([{ lineId: "x/beneficiary", rowId: "x", label: "Schwab IRA beneficiaries", reason: "Nothing ticked." }]);
    const out = (await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 412000 } })) as Record<string, unknown>;
    expect(out.leftOut).toEqual([{ lineId: "x/beneficiary", label: "Schwab IRA beneficiaries", reason: "Nothing ticked." }]);
    expect((out.saved as unknown[]).length).toBe(1);
    expect(h.discardImport).not.toHaveBeenCalled();
  });

  // Review Focus #5: a single edit that can't save writes nothing and leaves no draft behind.
  it("discards the import it created and says so when the edit changes nothing", async () => {
    reviewBuilds((rowId) => [accountLine(rowId, { action: "none", fields: [] })]);
    const err = await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 300000 } }).catch((e: unknown) => e);

    expect(err).toEqual(new McpInputError("Nothing to change — the plan already has these values."));
    expect(h.saveChangeSet).not.toHaveBeenCalled();
    expect(h.discardImport).toHaveBeenCalledWith(SCOPE, "u1");
    expect(h.recordAudit.mock.calls.some(([a]) => a.action === "mcp.tool_write")).toBe(false);
  });

  it("refuses a line that can't save with its reason, and discards the import", async () => {
    reviewBuilds((rowId) => [accountLine(rowId, { blocked: { reason: "Pick who owns it." } })]);
    const err = await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 412000 } }).catch((e: unknown) => e);

    expect(err).toEqual(new McpInputError("Schwab IRA can't save: Pick who owns it."));
    expect(h.saveChangeSet).not.toHaveBeenCalled();
    expect(h.discardImport).toHaveBeenCalledWith(SCOPE, "u1");
  });

  it("passes a save refusal back and discards the import", async () => {
    h.saveChangeSet.mockResolvedValue({ ok: false, status: 409, error: "“Schwab IRA” changed since you reviewed — review again.", lineId: "L1" });
    const err = await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 412000 } }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpInputError);
    expect((err as Error).message).toBe("“Schwab IRA” changed since you reviewed — review again.");
    expect(h.discardImport).toHaveBeenCalledWith(SCOPE, "u1");
  });

  it("passes a link waiting on the advisor back with its candidates, and discards the import", async () => {
    h.reviewFactFinder.mockResolvedValue({ ok: false, status: 409, body: { error: "1 link needs a click first." } });
    const err = await call({ sectionId: "salary", fixedRow: "Client", cells: { annualSalary: 150000 } }).catch((e: unknown) => e);

    expect(err).toEqual(new McpInputError("1 link needs a click first."));
    expect(h.saveChangeSet).not.toHaveBeenCalled();
    expect(h.discardImport).toHaveBeenCalledWith(SCOPE, "u1");
  });

  it("discards the import when the fact finder refuses a value", async () => {
    const refused = '"lots" isn\'t a valid Current value (a dollar amount).';
    h.editFactFinder.mockResolvedValue({ ok: false, status: 400, error: refused });
    const err = await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: "lots" } }).catch((e: unknown) => e);

    expect(err).toEqual(new McpInputError(refused));
    expect(h.reviewFactFinder).not.toHaveBeenCalled();
    expect(h.discardImport).toHaveBeenCalledWith(SCOPE, "u1");
  });

  // R23: the create check's refusals come before a draft exists, so there is nothing to discard.
  it("refuses a shared client before creating anything", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "shared" });
    const err = await call({ sectionId: "retirement", recordId: "acc-ira", cells: { currentValue: 1 } }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpForbiddenError);
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
    expect(h.discardImport).not.toHaveBeenCalled();
  });

  // R39: the refusals teach the ids, so Claude never opens a draft just to read them.
  it("refuses an unknown section, listing the sections, before creating anything", async () => {
    const err = await call({ sectionId: "retirment", cells: { currentValue: 1 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpInputError);
    expect((err as Error).message).toMatch(/^There's no fact finder section "retirment"\. Sections: .*\bpeople\b.*\bretirement\b.*\.$/);
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });

  it("refuses an unknown column, listing the section's columns, before creating anything", async () => {
    const err = await call({ sectionId: "salary", fixedRow: "Client", cells: { amount: 1, annualRaise: 0.03 } }).catch((e: unknown) => e);
    expect(err).toEqual(
      new McpInputError('Section salary has no column "amount". Its columns: employer, annualSalary, annualRaise, startYear, endYear.'),
    );
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });

  it("refuses an unknown fixed row, or a fixed-row section without one, listing its fixed rows, before creating anything", async () => {
    await expect(call({ sectionId: "people", fixedRow: "Partner", cells: { firstName: "x" } })).rejects.toThrow(
      new McpInputError('Section people has no fixed row "Partner". Its fixed rows: "Client", "Co-client".'),
    );
    await expect(call({ sectionId: "people", cells: { firstName: "x" } })).rejects.toThrow(
      new McpInputError('Section people needs a fixedRow. Its fixed rows: "Client", "Co-client".'),
    );
    await expect(call({ sectionId: "retirement", fixedRow: "Client", cells: { currentValue: 1 } })).rejects.toThrow(
      new McpInputError('Section retirement has no fixed row "Client". It has no fixed rows.'),
    );
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });

  it("never sends Claude to open a draft just to learn the ids", () => {
    expect(editTool.description).not.toMatch(/start_fact_finder_step/);
  });

  it("refuses no cells or more than 30 before creating anything", async () => {
    await expect(call({ sectionId: "retirement", recordId: "acc-ira", cells: {} })).rejects.toThrow();
    const tooMany = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`c${i}`, i]));
    await expect(call({ sectionId: "retirement", recordId: "acc-ira", cells: tooMany })).rejects.toThrow();
    expect(h.createFactFinderImport).not.toHaveBeenCalled();
  });
});

describe("update_plan_assumptions", () => {
  const call = (changes: Record<string, unknown>) => assumptionsTool.run({ clientId: "c1", changes }, principal);

  beforeEach(() => {
    h.loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        planSettings: { inflationRate: 0.025, inflationRateSource: "asset_class", defaultGrowthTaxable: 0.05, growthSourceTaxable: "model_portfolio", flatFederalRate: 0.22 },
      },
    });
    // The core's own validation; the stored row comes back with numeric columns as strings.
    h.updatePlanSettingsForClient.mockImplementation(async ({ body }: { body: Record<string, unknown> }) => {
      const invalid = validatePlanSettingsPatch(body);
      if (invalid) return { ok: false, status: 400, error: invalid };
      const data = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "number" ? v.toFixed(4) : v]));
      return { ok: true, data, resourceId: "ps1" };
    });
  });

  it("sets a default growth rate as a custom rate, on the principal, and returns each change before → after", async () => {
    const out = await call({ defaultGrowthTaxable: 0.06 });

    expect(h.updatePlanSettingsForClient).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      actorId: "u1",
      body: { defaultGrowthTaxable: 0.06, growthSourceTaxable: "custom" },
      principal,
    });
    expect(h.loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});
    expect(h.loadEffectiveTree.mock.invocationCallOrder[0]).toBeLessThan(h.updatePlanSettingsForClient.mock.invocationCallOrder[0]);
    expect(out).toEqual({
      changed: [
        { key: "defaultGrowthTaxable", from: 0.05, to: 0.06 },
        { key: "growthSourceTaxable", from: "model_portfolio", to: "custom" },
      ],
      foundryUrl: expect.stringMatching(/\/clients\/c1\/details\/assumptions$/),
    });
  });

  it("sets inflation as a custom rate", async () => {
    const out = (await call({ inflationRate: 0.03 })) as { changed: unknown[] };
    expect(h.updatePlanSettingsForClient.mock.calls[0][0].body).toEqual({ inflationRate: 0.03, inflationRateSource: "custom" });
    expect(out.changed).toEqual([
      { key: "inflationRate", from: 0.025, to: 0.03 },
      { key: "inflationRateSource", from: "asset_class", to: "custom" },
    ]);
  });

  // The brief named inflationRate: 1.5, but the core bounds inflation only to ±10 (validate-patch's
  // NEVER_EMPTY_RATE_KEYS); flatFederalRate is one of the rates it bounds to 0..1.
  it("passes the core's refusal back in its own words", async () => {
    await expect(call({ flatFederalRate: 1.5 })).rejects.toThrow(new McpInputError("flatFederalRate must be between 0 and 1"));
    expect(h.recordAudit.mock.calls.some(([a]) => a.action === "mcp.tool_write")).toBe(false);
  });

  // R38: the core bounds these to ±1000% (or not at all), so 3 meant as 3% would save as 300%.
  it("refuses a rate sent as a percent, naming it, before reading or writing anything", async () => {
    await expect(call({ inflationRate: 1.5 })).rejects.toThrow(
      new McpInputError("inflationRate is out of range: rates are fractions, 0.03 = 3%."),
    );
    await expect(call({ flatFederalRate: 0.22, defaultGrowthTaxable: 6 })).rejects.toThrow(
      new McpInputError("defaultGrowthTaxable is out of range: rates are fractions, 0.03 = 3%."),
    );
    await expect(call({ ssWageGrowthRate: -2 })).rejects.toThrow(/^ssWageGrowthRate is out of range/);
    await expect(call({ taxInflationRate: 3 })).rejects.toThrow(/^taxInflationRate is out of range/);
    expect(h.loadEffectiveTree).not.toHaveBeenCalled();
    expect(h.updatePlanSettingsForClient).not.toHaveBeenCalled();
  });

  it("takes a negative or whole-number fraction up to 1", async () => {
    await call({ defaultGrowthCash: -0.01, inflationRate: 1 });
    expect(h.updatePlanSettingsForClient).toHaveBeenCalledTimes(1);
  });

  it("audits the settings changed, never their values", async () => {
    await call({ flatFederalRate: 0.24, residenceState: "CO" });
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ keys: ["flatFederalRate", "residenceState"], tool: "update_plan_assumptions", via: "claude" });
  });

  it("refuses a call that changes nothing, and a view-only household, before writing", async () => {
    await expect(call({})).rejects.toThrow();
    h.verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
    await expect(call({ inflationRate: 0.03 })).rejects.toThrow(VIEW_ONLY_MESSAGE);
    expect(h.updatePlanSettingsForClient).not.toHaveBeenCalled();
  });
});

describe("remove_plan_detail", () => {
  const call = (args: Record<string, unknown>) => removeTool.run({ clientId: "c1", recordId: "r1", ...args }, principal);
  const cores = {
    account: h.deleteAccountForClient,
    liability: h.deleteLiabilityForClient,
    income: h.deleteIncomeForClient,
    expense: h.deleteExpenseForClient,
  };
  const idArg = { account: "accountId", liability: "liabilityId", income: "incomeId", expense: "expenseId" } as const;

  beforeEach(() => {
    h.labelRows.mockResolvedValue([{ name: "Schwab IRA" }]);
    for (const core of [...Object.values(cores), h.deleteSavingsRuleForClient]) {
      core.mockResolvedValue({ ok: true, data: { id: "r1" }, resourceId: "r1" });
    }
  });

  it("is a destructive write", () => {
    expect(removeTool.annotations?.destructiveHint).toBe(true);
  });

  for (const kind of ["account", "liability", "income", "expense"] as const) {
    it(`removes a ${kind} through its core with the principal, naming it`, async () => {
      const out = await call({ kind });
      expect(cores[kind]).toHaveBeenCalledWith({ clientId: "c1", firmId: "org_1", actorId: "u1", [idArg[kind]]: "r1", principal });
      expect(out).toMatchObject({ removed: { kind, recordId: "r1", label: "Schwab IRA" } });
    });
  }

  it("removes a savings rule with no principal, labelled by its account", async () => {
    const out = await call({ kind: "savings_rule" });
    expect(h.deleteSavingsRuleForClient).toHaveBeenCalledWith({ clientId: "c1", firmId: "org_1", actorId: "u1", ruleId: "r1" });
    expect(out).toMatchObject({ removed: { kind: "savings_rule", recordId: "r1", label: "Schwab IRA" } });
  });

  it("labels a savings rule with no account as Planned savings", async () => {
    h.labelRows.mockResolvedValue([{ name: null }]);
    const out = (await call({ kind: "savings_rule" })) as { removed: { label: string } };
    expect(out.removed.label).toBe("Planned savings");
  });

  it("reads the label before the delete, and never loads the whole record book", async () => {
    const order: string[] = [];
    h.labelRows.mockImplementation(async () => (order.push("label"), [{ name: "Joint Brokerage" }]));
    h.deleteAccountForClient.mockImplementation(async () => (order.push("delete"), { ok: true, data: { id: "r1" }, resourceId: "r1" }));
    await call({ kind: "account" });
    expect(order).toEqual(["label", "delete"]);
    expect(h.loadRecordBook).not.toHaveBeenCalled();
  });

  it("still calls the core when no row is found, and shows its refusal verbatim", async () => {
    h.labelRows.mockResolvedValue([]);
    h.deleteAccountForClient.mockResolvedValue({ ok: false, status: 404, error: "Account not found" });
    await expect(call({ kind: "account" })).rejects.toThrow(new McpInputError("Account not found"));
    expect(h.deleteAccountForClient).toHaveBeenCalledTimes(1);
  });

  it("surfaces the default cash account's refusal verbatim", async () => {
    const msg = "This is a system-managed cash account and can't be deleted.";
    h.deleteAccountForClient.mockResolvedValue({ ok: false, status: 400, error: msg });
    await expect(call({ kind: "account" })).rejects.toThrow(new McpInputError(msg));
  });

  it("fails schema parse on an unknown kind, calling nothing", async () => {
    await expect(call({ kind: "client" })).rejects.toThrow();
    await expect(call({ kind: "household" })).rejects.toThrow();
    expect(h.labelRows).not.toHaveBeenCalled();
    for (const core of [...Object.values(cores), h.deleteSavingsRuleForClient]) expect(core).not.toHaveBeenCalled();
  });

  it("audits the kind and id", async () => {
    await call({ kind: "income" });
    const audit = h.recordAudit.mock.calls.find(([a]) => a.action === "mcp.tool_write")![0];
    expect(audit.metadata).toEqual({ kind: "income", recordId: "r1", tool: "remove_plan_detail", via: "claude" });
  });

  it("refuses a view-only household before reading or deleting", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
    await expect(call({ kind: "account" })).rejects.toThrow(VIEW_ONLY_MESSAGE);
    expect(h.labelRows).not.toHaveBeenCalled();
    expect(h.deleteAccountForClient).not.toHaveBeenCalled();
  });
});
