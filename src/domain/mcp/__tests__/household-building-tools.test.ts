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
}));

// The real create check (it reads the mocked client access and audit); the import gate is stubbed.
vi.mock("@/lib/fact-finder/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fact-finder/gate")>()),
  factFinderGateFor: h.factFinderGateFor,
}));
vi.mock("@/lib/fact-finder/import-lifecycle", () => ({ createFactFinderImport: h.createFactFinderImport }));
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
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: h.ensurePlanImport }));
vi.mock("@/lib/crm/duplicate-household", () => ({ findLikelyDuplicateHousehold: h.findLikelyDuplicateHousehold }));
vi.mock("@/lib/crm/authz", () => ({ verifyCrmHouseholdAccessFor: h.verifyCrmHouseholdAccessFor }));
vi.mock("@/lib/ai/resolve", () => ({ withAiCallerOrg: h.withAiCallerOrg }));

import { householdBuildingTools } from "../tools/household-building";
import { WRITE_DISABLED_MESSAGE } from "../define-tool";
import { changeListView } from "../change-list-view";
import { McpInputError } from "../define-tool";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
import { SAVE_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import { defaultTicks, type ChangeField, type ChangeLine, type ChangeSet } from "@/lib/fact-finder/change-set";
import { emptyRecordBook, type RecordBook } from "@/lib/fact-finder/placement/types";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";
import type { McpPrincipal } from "@/lib/mcp/principal";

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
      'Section people has no fixed row "Partner"; use one of its fixedRows.',
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
      leftOut: 1,
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
    expect(out).toEqual({ created: true, clientId: "c9", householdId: "hh9", importId: IMPORT, nextStep: "household" });
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
    expect(out).toEqual({ created: true, clientId: "c9", householdId: "hh9", importId: IMPORT, nextStep: "household" });
  });

  it("passes the spouse's retirement age for a prospect", async () => {
    await create.run(
      { householdId: "hh9", prospect: { filingStatus: "married_joint", retirementAge: 66, spouseRetirementAge: 64 } },
      principal,
    );
    expect(h.ensurePlanImport.mock.calls[0][0].prospect).toMatchObject({ spouseRetirementAge: 64, spouseLifeExpectancy: 95 });
  });

  it("answers the core's retirement-age refusal as an input error", async () => {
    h.ensurePlanImport.mockRejectedValue(new Error("Ben's retirement age is required."));
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
