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

import { householdBuildingTools } from "../tools/household-building";
import { McpInputError } from "../define-tool";
import { CLIENT_UNREADABLE_MESSAGE, McpForbiddenError } from "../guards";
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
  h.resolveBaseCaseScenarioId.mockResolvedValue(BASE);
  h.loadRecordBook.mockResolvedValue(seededBook());
  h.createFactFinderImport.mockResolvedValue({ id: IMPORT, payloadJson: { factFinder: emptyFactFinderState() } });
  gateAllows();
  // By default the edit lands: the state the ops produced, one version on.
  h.editFactFinder.mockImplementation(async (_scope, current: FactFinderState) => ({
    ok: true,
    state: { ...current, version: current.version + 1 },
  }));
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
    // Another advisor's import, or none: the same answer.
    for (const [status, error] of [[404, "Import not found"], [403, "Forbidden"]] as const) {
      const step = await refusedWith(status, error);
      expect(step).toBeInstanceOf(McpInputError);
      expect((step as Error).message).toBe("That fact finder step wasn't found. Use the importId start_fact_finder_step returned.");
    }
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
