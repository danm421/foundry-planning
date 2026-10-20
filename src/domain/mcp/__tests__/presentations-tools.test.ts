// src/domain/mcp/__tests__/presentations-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // Rows the fake db answers with, by table — the connector's three scoped reads.
  rows: {
    scenarios: [] as { id: string }[],
    scenario_snapshots: [] as { id: string }[],
    clients: [] as { householdId: string | null }[],
  } as Record<string, unknown[]>,
  queuePresentationRun: vi.fn(),
  getTemplateById: vi.fn(),
  listTemplatesForUser: vi.fn(),
  listDismissedSlugs: vi.fn(),
  loadPlanFacts: vi.fn(),
  scoreReports: vi.fn(),
  getRunForHousehold: vi.fn(),
  checkExportPdfRateLimit: vi.fn(),
  firmClaudeWritesEnabled: vi.fn(),
  verifyClientAccessFor: vi.fn(),
}));

// Drizzle stamps every table with its SQL name under this symbol, so the fake
// answers by WHICH table a query hit (the save-scenario route suite's pattern).
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: Record<symbol, string>) => ({
        where: async () => h.rows[table[Symbol.for("drizzle:Name")]] ?? [],
      }),
    }),
  },
}));
vi.mock("@/lib/presentations/queue-run", () => ({ queuePresentationRun: h.queuePresentationRun }));
vi.mock("@/lib/presentations/templates-repo", () => ({
  getTemplateById: h.getTemplateById,
  listTemplatesForUser: h.listTemplatesForUser,
}));
vi.mock("@/lib/presentations/builtin-templates-repo", () => ({ listDismissedSlugs: h.listDismissedSlugs }));
vi.mock("@/lib/presentations/suggestions/load-plan-facts", () => ({ loadPlanFacts: h.loadPlanFacts }));
vi.mock("@/lib/presentations/suggestions/score-reports", () => ({ scoreReports: h.scoreReports }));
vi.mock("@/lib/crm/generation-runs", () => ({ getRunForHousehold: h.getRunForHousehold }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
  checkExportPdfRateLimit: h.checkExportPdfRateLimit,
}));
vi.mock("@/lib/firm-settings", () => ({ firmClaudeWritesEnabled: h.firmClaudeWritesEnabled }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import {
  presentationTools,
  RENDER_FAILED_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
  DECK_NOT_SAVED_MESSAGE,
} from "../tools/presentations";
import { NO_HOUSEHOLD_MESSAGE } from "../presentation-decks";
import { scenarioNotFoundMessage } from "../whatif-jobs";
import { BILLING_WRITE_BLOCKED_MESSAGE, McpUnavailableError } from "../define-tool";
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
const byName = (n: string) => presentationTools.find((t) => t.name === n)!;
const OWNED = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "99999999-9999-4999-8999-999999999999";
const TEMPLATE = "77777777-7777-4777-8777-777777777777";
const RUN = "55555555-5555-4555-8555-555555555555";

type QueuedBody = {
  scenarioId: string | null;
  filename?: string;
  pages: Array<{ pageId: string; options: Record<string, unknown>; scenarioOverride?: string }>;
};
const queuedBody = () => h.queuePresentationRun.mock.calls[0][0].body as QueuedBody;

beforeEach(() => {
  h.rows.scenarios = [{ id: OWNED }];
  h.rows.scenario_snapshots = [];
  h.rows.clients = [{ householdId: "hh1" }];
  h.queuePresentationRun.mockReset().mockResolvedValue({ runId: "run1", storyReview: [] });
  h.getTemplateById.mockReset().mockResolvedValue(null);
  h.listTemplatesForUser.mockReset().mockResolvedValue({ shared: [], mine: [] });
  h.listDismissedSlugs.mockReset().mockResolvedValue(new Set());
  h.loadPlanFacts.mockReset().mockResolvedValue({});
  h.scoreReports.mockReset().mockReturnValue([]);
  h.getRunForHousehold.mockReset().mockResolvedValue(null);
  h.checkExportPdfRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 });
  h.firmClaudeWritesEnabled.mockReset().mockResolvedValue(true);
  h.verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" });
});

describe("list_presentation_pages", () => {
  const list = () =>
    byName("list_presentation_pages").run({ clientId: "c1" }, principal) as Promise<{
      pages: Array<Record<string, unknown>>;
      templates: Array<{ id: string; kind: string; pageIds: string[] }>;
      suggested: unknown[];
    }>;

  it("lists every registry page with what it needs", async () => {
    const { pages } = await list();
    const page = (id: string) => pages.find((p) => p.id === id);
    expect(pages).toHaveLength(Object.keys(PRESENTATION_PAGES).length);
    expect(page("cashFlow")).toMatchObject({ takesScenario: true, needsScenario: false, needsMonteCarlo: false, needsSetupInFoundry: false });
    expect(page("monteCarlo")).toMatchObject({ needsMonteCarlo: true });
    expect(page("retirementComparison")).toMatchObject({ takesScenario: true, needsScenario: true, needsSetupInFoundry: false });
    expect(page("scenarioComparison")).toMatchObject({ needsSetupInFoundry: true });
  });

  it("lists built-in, shared and own templates, leaving out dismissed built-ins", async () => {
    h.listDismissedSlugs.mockResolvedValue(new Set(["cash-flow-details"]));
    h.listTemplatesForUser.mockResolvedValue({
      shared: [{ id: "t-shared", name: "Firm deck", pages: [{ pageId: "cover", options: {} }] }],
      mine: [{ id: "t-mine", name: "My deck", pages: [{ pageId: "cashFlow", options: {} }] }],
    });
    const { templates } = await list();
    expect(templates.map((t) => [t.id, t.kind])).toEqual([
      ["builtin:foundation-plan", "built_in"],
      ["builtin:comparison-plan", "built_in"],
      ["builtin:your-early-years", "built_in"],
      ["t-shared", "shared"],
      ["t-mine", "mine"],
    ]);
    expect(templates.at(-1)!.pageIds).toEqual(["cashFlow"]);
  });

  it("suggests pages for the household, and still answers when the suggestions fail", async () => {
    h.scoreReports.mockReturnValue([{ pageId: "rothConversion", score: 80, reason: "Converts in 2027." }]);
    expect((await list()).suggested).toEqual([{ pageId: "rothConversion", reason: "Converts in 2027." }]);

    h.loadPlanFacts.mockRejectedValue(new Error("tree failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await list();
    errorSpy.mockRestore();
    expect(again.suggested).toEqual([]);
    expect(again.pages.length).toBeGreaterThan(0);
  });
});

describe("generate_presentation", () => {
  const run = (args: Record<string, unknown>) =>
    byName("generate_presentation").run({ clientId: "c1", ...args }, principal);

  it("queues the pages as the app would, as the advisor, into the household's documents", async () => {
    const out = await run({ title: "Smith review", pages: [{ pageId: "cover" }, { pageId: "cashFlow", scenarioId: OWNED }] });
    expect(out).toMatchObject({ runId: "run1", status: "queued", pageCount: 2 });
    expect(h.queuePresentationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        firmId: "org_1",
        householdId: "hh1",
        triggeredBy: "u1",
        triggeredByEmail: null,
        auditActorId: "u1",
        auditMetadata: {},
        via: "claude",
        // No session behind the connector: its AI commentary resolves for the
        // token's verified firm, and no deck renders without a run to poll.
        aiCallerOrgId: "org_1",
        requireRun: true,
      }),
    );
    const body = queuedBody();
    expect(body.scenarioId).toBeNull();
    expect(body.filename).toBe("Smith review.pdf");
    expect(body.pages.map((p) => p.pageId)).toEqual(["cover", "cashFlow"]);
    expect(body.pages[1].scenarioOverride).toBe(OWNED);
  });

  it("refuses a page naming another household's scenario, before anything is queued", async () => {
    await expect(run({ pages: [{ pageId: "cashFlow", scenarioId: FOREIGN }] })).rejects.toThrow(
      scenarioNotFoundMessage(FOREIGN),
    );
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("refuses a page naming another household's snapshot, before the export limit is charged or anything is queued", async () => {
    await expect(run({ pages: [{ pageId: "cashFlow", scenarioId: `snap:${FOREIGN}` }] })).rejects.toThrow(
      `Snapshot ${FOREIGN} isn't one of this household's snapshots.`,
    );
    expect(h.checkExportPdfRateLimit).not.toHaveBeenCalled();
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("queues a page set to one of this household's snapshots", async () => {
    h.rows.scenario_snapshots = [{ id: OWNED }];
    await run({ pages: [{ pageId: "cashFlow", scenarioId: `snap:${OWNED}` }] });
    expect(queuedBody().pages[0].scenarioOverride).toBe(`snap:${OWNED}`);
  });

  it("refuses a saved template whose options name another household's scenario", async () => {
    h.getTemplateById.mockResolvedValue({
      id: TEMPLATE,
      firmId: "org_1",
      createdByUserId: "u1",
      visibility: "private",
      name: "Old deck",
      pages: [
        {
          pageId: "retirementComparison",
          options: { ...(PRESENTATION_PAGES.retirementComparison.defaultOptions as object), scenarioId: FOREIGN },
        },
      ],
    });
    await expect(run({ templateId: TEMPLATE })).rejects.toThrow(scenarioNotFoundMessage(FOREIGN));
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("refuses a saved Plan Story whose story names another household's scenario, though the render's plan never loads it", async () => {
    h.getTemplateById.mockResolvedValue({
      id: TEMPLATE,
      firmId: "org_1",
      createdByUserId: "u1",
      visibility: "private",
      name: "Story deck",
      pages: [{ pageId: "planStory", options: { ...(PRESENTATION_PAGES.planStory.defaultOptions as object), scenarioId: FOREIGN } }],
    });
    await expect(run({ templateId: TEMPLATE })).rejects.toThrow(scenarioNotFoundMessage(FOREIGN));
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("refuses another advisor's private template as not found", async () => {
    h.getTemplateById.mockResolvedValue({
      id: TEMPLATE,
      firmId: "org_1",
      createdByUserId: "someone_else",
      visibility: "private",
      name: "Theirs",
      pages: [{ pageId: "cover", options: PRESENTATION_PAGES.cover.defaultOptions }],
    });
    await expect(run({ templateId: TEMPLATE })).rejects.toThrow(`Template ${TEMPLATE} not found`);
  });

  it("fills a built-in template's blank comparison pages with the deck's scenario", async () => {
    await run({ templateId: "builtin:comparison-plan", scenarioId: OWNED });
    const body = queuedBody();
    expect(body.scenarioId).toBe(OWNED);
    for (const id of ["scenarioChanges", "retirementComparison", "taxComparison"]) {
      expect(body.pages.find((p) => p.pageId === id)?.options.scenarioId).toBe(OWNED);
    }
  });

  it("refuses a comparison page with nothing to compare, and a page that needs setting up in Foundry", async () => {
    await expect(run({ pages: [{ pageId: "retirementComparison" }] })).rejects.toThrow(/compares the plan with a scenario/);
    await expect(run({ pages: [{ pageId: "scenarioComparison" }] })).rejects.toThrow(/Build that page in Foundry/);
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("holds the render's scenario caps", async () => {
    // Base (the deck's own scenario) plus six overrides is seven distinct scenarios.
    const ids = Array.from({ length: 6 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`);
    h.rows.scenarios = ids.map((id) => ({ id }));
    await expect(run({ pages: ids.map((id) => ({ pageId: "cashFlow", scenarioId: id })) })).rejects.toThrow(
      "Too many distinct scenarios in one deck (7). Limit is 6.",
    );
  });

  it("refuses a client with no CRM household, an unknown page, and neither-or-both of templateId and pages", async () => {
    await expect(run({ pages: [{ pageId: "constructor" }] })).rejects.toThrow('Unknown page "constructor"');
    await expect(run({})).rejects.toThrow(/exactly one of them/);
    await expect(run({ templateId: "builtin:foundation-plan", pages: [{ pageId: "cover" }] })).rejects.toThrow(
      /exactly one of them/,
    );
    h.rows.clients = [{ householdId: null }];
    await expect(run({ pages: [{ pageId: "cover" }] })).rejects.toThrow(NO_HOUSEHOLD_MESSAGE);
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("passes the Plan Story review count on as a note", async () => {
    h.queuePresentationRun.mockResolvedValue({
      runId: "run1",
      storyReview: [{ pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 3, total: 9 }],
    });
    const out = (await run({ pages: [{ pageId: "cover" }] })) as { notes: string[] };
    expect(out.notes[0]).toMatch(/3 of 9 chapters/);
  });

  it("refuses when the firm's billing blocks writes", async () => {
    await expect(
      byName("generate_presentation").run(
        { clientId: "c1", pages: [{ pageId: "cover" }] },
        { ...principal, canWrite: false },
      ),
    ).rejects.toThrow(BILLING_WRITE_BLOCKED_MESSAGE);
    expect(h.checkExportPdfRateLimit).not.toHaveBeenCalled();
    expect(h.queuePresentationRun).not.toHaveBeenCalled();
  });

  it("reports the connector unavailable when the run can't be queued", async () => {
    h.queuePresentationRun.mockResolvedValue({ runId: null, storyReview: [] });
    await expect(run({ pages: [{ pageId: "cover" }] })).rejects.toBeInstanceOf(McpUnavailableError);
  });
});

describe("get_presentation_status", () => {
  const status = (runId = RUN) => byName("get_presentation_status").run({ clientId: "c1", runId }, principal);
  const runRow = (over: Record<string, unknown> = {}) => ({
    id: RUN,
    clientId: "c1",
    kind: "presentation",
    status: "done",
    resultDocumentId: "doc1",
    requestPayload: { pages: [{}, {}, {}] },
    error: "pg: relation generation_runs does not exist",
    ...over,
  });

  it("hands back a sign-in link to the saved deck when it's done", async () => {
    h.getRunForHousehold.mockResolvedValue(runRow());
    const out = (await status()) as Record<string, unknown>;
    expect(h.getRunForHousehold).toHaveBeenCalledWith(RUN, "hh1", "org_1");
    expect(out).toMatchObject({ status: "done", pageCount: 3 });
    expect(out.downloadUrl).toMatch(/\/api\/crm\/households\/hh1\/documents\/doc1$/);
  });

  it("says running while in flight, and never passes on a failure's internal reason", async () => {
    h.getRunForHousehold.mockResolvedValue(runRow({ status: "analyzing" }));
    expect(await status()).toMatchObject({ status: "running" });
    h.getRunForHousehold.mockResolvedValue(runRow({ status: "failed" }));
    const failed = await status();
    expect(failed).toMatchObject({ status: "failed", error: RENDER_FAILED_MESSAGE });
    expect(JSON.stringify(failed)).not.toContain("pg:");
    h.getRunForHousehold.mockResolvedValue(runRow({ resultDocumentId: null }));
    expect(await status()).toMatchObject({ status: "failed", error: DECK_NOT_SAVED_MESSAGE });
  });

  it("answers another client's run, another kind of run and a malformed id the same way", async () => {
    h.getRunForHousehold.mockResolvedValue(runRow({ clientId: "c2" }));
    await expect(status()).rejects.toThrow(RUN_NOT_FOUND_MESSAGE);
    h.getRunForHousehold.mockResolvedValue(runRow({ kind: "meeting_prep" }));
    await expect(status()).rejects.toThrow(RUN_NOT_FOUND_MESSAGE);
    h.getRunForHousehold.mockClear();
    await expect(status("not-a-uuid")).rejects.toThrow(RUN_NOT_FOUND_MESSAGE);
    expect(h.getRunForHousehold).not.toHaveBeenCalled();
  });
});
