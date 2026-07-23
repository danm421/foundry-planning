// src/domain/forge/__tests__/tools-index.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildToolContext } from "../context";
import { buildGlobalTools } from "../tools/global-index";
import type { ForgeAuthContext } from "../state";

// Stub the IO/engine deps the read+compute+whatif tools import at module load
// so this assembly test stays a pure unit (no DB, no Azure, no engine run).
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({ loadMonteCarloData: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/engine", () => ({ runProjection: vi.fn(), runProjectionWithEvents: vi.fn() }));
vi.mock("@/lib/solver/solve-target", () => ({ solveTarget: vi.fn() }));
vi.mock("@/lib/solver/solve-max-spending", () => ({ solveMaxSpending: vi.fn() }));
vi.mock("@/lib/solver/solve-ss-portfolio", () => ({ solveSsClaimAgeByPortfolio: vi.fn() }));
vi.mock("@/engine/scenario/applyChanges", () => ({ applyScenarioChanges: vi.fn() }));
vi.mock("@/engine/what-if/life-insurance-need", () => ({
  runLifeInsuranceWhatIf: vi.fn(),
  survivorEndingPortfolio: vi.fn(),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: vi.fn() }));
// Phase 2: stub scenario-writes IO deps
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
// Phase 3: stub detail-writes (expense + income) cores
vi.mock("@/lib/clients/expenses-writes", () => ({
  createExpenseForClient: vi.fn(),
  updateExpenseForClient: vi.fn(),
  deleteExpenseForClient: vi.fn(),
}));
vi.mock("@/lib/clients/incomes-writes", () => ({
  createIncomeForClient: vi.fn(),
  updateIncomeForClient: vi.fn(),
  deleteIncomeForClient: vi.fn(),
}));
vi.mock("@/lib/clients/liabilities-writes", () => ({
  createLiabilityForClient: vi.fn(),
  updateLiabilityForClient: vi.fn(),
  deleteLiabilityForClient: vi.fn(),
}));
vi.mock("@/lib/clients/accounts-writes", () => ({
  createAccountForClient: vi.fn(),
  updateAccountForClient: vi.fn(),
  deleteAccountForClient: vi.fn(),
}));
// CRM tool deps (assembly test stays pure — no DB, no CRM IO)
vi.mock("@/lib/crm/notes", () => ({ createNote: vi.fn(), listHouseholdNotes: vi.fn(), deleteNote: vi.fn() }));
vi.mock("@/lib/crm/schemas", () => ({ createCrmNoteSchema: { parse: vi.fn() } }));
vi.mock("@/lib/crm/activity", () => ({ recordActivity: vi.fn(), listActivity: vi.fn() }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: vi.fn(), getTaskById: vi.fn(), listTaskComments: vi.fn(), listTaskActivity: vi.fn(), listTaskFiles: vi.fn() }));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn(), updateTaskField: vi.fn(), setTaskStatus: vi.fn(), postComment: vi.fn(), deleteTask: vi.fn() }));
vi.mock("@/lib/crm-tasks/schemas", () => ({ createCrmTaskSchema: { parse: vi.fn() } }));
vi.mock("@/lib/overview/list-open-items", () => ({ listOpenItems: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({ getCrmHousehold: vi.fn(), listCrmHouseholds: vi.fn(), createCrmHousehold: vi.fn() }));
vi.mock("@/lib/overview/get-overview-data", () => ({ getOverviewData: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ computeAlerts: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("../guards", () => ({ clientToHousehold: vi.fn(), assertHouseholdReadable: vi.fn() }));
vi.mock("../account-mask", () => ({ maskSsnLast4: vi.fn() }));
// Phase 4: stub the report tool's IO + heavy registry deps so this stays pure.
vi.mock("@/components/presentations/registry", () => ({ PRESENTATION_PAGES: {} }));
vi.mock("@/components/presentations/render-presentation-pdf", () => ({
  BodySchema: { safeParse: vi.fn() },
  renderPresentationPdf: vi.fn(),
}));
vi.mock("@/lib/crm/generation-runs", () => ({
  createQueuedRun: vi.fn(),
  markRunning: vi.fn(),
  markDone: vi.fn(),
  markFailed: vi.fn(),
}));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: vi.fn() }));
// Phase 4: stub the knowledge tool's embedding dep so this stays pure.
// Also stub chatModel for the meetings bundle (called at runtime, but imported at load).
vi.mock("../llm", () => ({ embeddings: vi.fn(), chatModel: vi.fn() }));
// Book bundle: stub the book-scan lib so this stays pure (no DB). book.ts reads
// SIGNAL_KEYS/limit constants at tool-build time, so the stub must provide them
// (values mirror src/lib/book-scan/scan.ts).
vi.mock("@/lib/book-scan/scan", () => ({
  scanBook: vi.fn(),
  SIGNAL_KEYS: ["netWorth", "liquid", "cashBalance", "lastContactDays", "openTasks", "openItems"],
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 200,
}));
// Meetings bundle: stub transcript lib so assembly stays pure (no DB).
vi.mock("@/lib/forge/meeting-transcripts", () => ({ getOwnedMeetingTranscript: vi.fn(), deleteMeetingTranscript: vi.fn() }));
// Meetings bundle: stub CRM write deps so assembly stays pure.
vi.mock("@/lib/crm/documents", () => ({ uploadCrmDocument: vi.fn() }));
vi.mock("@/lib/crm/folders", () => ({ ensureTranscriptsFolder: vi.fn() }));
// navigate-global / global-actions import custom-events which imports server-only
// (not resolvable from the worktree node_modules). Mock it so the global set test passes.
vi.mock("../custom-events", () => ({ emitNavigate: vi.fn(), emitPageLink: vi.fn(), emitWalkthrough: vi.fn() }));
// global-actions (set_up_plan) imports create-client which imports @/db.
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: vi.fn() }));
// plan-builder / global-actions build_plan tools import the shared plan-import core.
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: vi.fn() }));

import { buildTools, WRITE_TOOL_NAMES, TOOL_BUNDLES } from "../tools";
import { routeAfterAgent } from "../routing";

const ctx: ForgeAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

const EXPECTED_PHASE1 = [
  // read
  "find_client",
  "client_briefing",
  "list_scenarios",
  "read_detail",
  "read_import",
  "extract_import",
  "search_planning_kb",
  // compute
  "run_projection",
  "run_monte_carlo",
  "compare_scenarios",
  "explain_report",
  "explain_projection_change",
  "break_down_projection_figure",
  // whatif + solvers
  "whatif_roth",
  "whatif_social_security",
  "whatif_withdrawal",
  "whatif_estate_tax",
  "whatif_life_insurance_need",
  "solve_goal",
  "solve_max_spending",
];

const EXPECTED_SCENARIO_WRITE_TOOL_NAMES = [
  "compare_and_snapshot",
  "create_scenario",
  "propose_changes",
  "revert_change",
  "promote_to_base",
];

const EXPECTED_DETAIL_WRITE_TOOL_NAMES = [
  "add_expense",
  "update_expense",
  "remove_expense",
  "add_income",
  "update_income",
  "remove_income",
  "add_liability",
  "update_liability",
  "remove_liability",
  "add_account",
  "update_account",
  "remove_account",
];

const EXPECTED_CRM_TIER_B_TOOL_NAMES = [
  "crm_create_tasks",
  "crm_delete_note",
  "crm_delete_task",
];

const EXPECTED_CRM_ALL_20 = [
  // read (5)
  "crm_client_card",
  "crm_recent_notes",
  "crm_list_tasks",
  "crm_task_detail",
  "crm_activity_feed",
  // Tier-A writes (6)
  "crm_add_note",
  "crm_log_activity",
  "crm_create_task",
  "crm_update_task",
  "crm_complete_task",
  "crm_post_task_comment",
  // Tier-B writes (3)
  "crm_delete_note",
  "crm_delete_task",
  "crm_create_tasks",
  // composite skills (6)
  "meeting_prep",
  "generate_agenda",
  "draft_follow_up",
  "summarize_notes",
  "whats_changed_since",
  "suggest_tasks",
];

const EXPECTED_MEMORY_TOOL_NAMES = ["read_memory", "write_memory"];

const EXPECTED_BOOK = ["scan_book"];

const EXPECTED_NAVIGATE = ["open_page", "cite_page"];

const EXPECTED_PLAN_BUILDER_TOOL_NAMES = ["get_plan_status", "build_plan"];

describe("buildTools (Phase 1 + Phase 2 + Phase 3 + Phase 4 + memory assembly + book + navigate)", () => {
  it("returns exactly the 67 named tools (20 Phase-1 + 5 scenario writes + 12 detail writes + 20 CRM + 1 report + 2 memory + 1 book + 2 navigate + 2 meetings + 2 plan builder = 67, + 1 meeting save)", () => {
    const tools = buildTools(TOOL_CTX);
    const names = new Set(tools.map((t) => t.name));
    // Phase-1, scenario-write, detail-write, report, memory, navigate, meetings, and plan-builder tools all present
    for (const n of [
      ...EXPECTED_PHASE1,
      ...EXPECTED_SCENARIO_WRITE_TOOL_NAMES,
      ...EXPECTED_DETAIL_WRITE_TOOL_NAMES,
      "generate_report",
      ...EXPECTED_MEMORY_TOOL_NAMES,
      ...EXPECTED_NAVIGATE,
      "summarize_meeting_transcript",
      "save_meeting_record",
      ...EXPECTED_PLAN_BUILDER_TOOL_NAMES,
    ]) {
      expect(names.has(n), `expected ${n} in buildTools output`).toBe(true);
    }
    expect(tools).toHaveLength(67);
  });

  it("memory tools are present and NOT in WRITE_TOOL_NAMES (non-destructive prefs)", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_MEMORY_TOOL_NAMES) {
      expect(names.has(n), `expected memory tool ${n} in buildTools output`).toBe(true);
      expect(WRITE_TOOL_NAMES.has(n), `${n} must NOT be approval-gated`).toBe(false);
    }
  });

  it("buildTools includes the 12 detail-write (expense + income + liability + account) tool names", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_DETAIL_WRITE_TOOL_NAMES) {
      expect(names.has(n), `expected detail-write tool ${n} in buildTools output`).toBe(true);
    }
  });

  it("buildTools includes all 20 CRM tools by name", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_CRM_ALL_20) {
      expect(names.has(n), `expected CRM tool ${n} in buildTools output`).toBe(true);
    }
  });

  it("has no duplicate tool names", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("buildTools includes the plan-builder tool names (get_plan_status, build_plan)", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_PLAN_BUILDER_TOOL_NAMES) {
      expect(names.has(n), `expected plan-builder tool ${n} in buildTools output`).toBe(true);
    }
  });

  it("get_plan_status is NOT in WRITE_TOOL_NAMES (read-only); build_plan IS (HITL-gated)", () => {
    expect(WRITE_TOOL_NAMES.has("get_plan_status")).toBe(false);
    expect(WRITE_TOOL_NAMES.has("build_plan")).toBe(true);
  });

  it("build_plan routes through the HITL approval gate", () => {
    expect(routeAfterAgent([{ name: "build_plan" }], WRITE_TOOL_NAMES)).toBe("approval");
  });

  it("WRITE_TOOL_NAMES is a non-empty Set (27 entries: 5 scenario writes + 12 detail writes + 3 Tier-B CRM writes + 1 meeting save + 4 global writes + 1 plan builder write + 1 fact-finder ingest write)", () => {
    expect(WRITE_TOOL_NAMES instanceof Set).toBe(true);
    expect(WRITE_TOOL_NAMES.size).toBe(27);
    expect(WRITE_TOOL_NAMES.has("save_meeting_record")).toBe(true);
  });

  it("WRITE_TOOL_NAMES contains the 12 detail-write (expense + income + liability + account) tool names", () => {
    for (const n of EXPECTED_DETAIL_WRITE_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });
});

describe("buildTools + WRITE_TOOL_NAMES (Phase 2 scenario writes)", () => {
  it("WRITE_TOOL_NAMES contains exactly the 5 scenario-write tool names", () => {
    for (const n of EXPECTED_SCENARIO_WRITE_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });

  it("promote_to_base is a write tool that routes through the HITL approval gate", () => {
    expect(WRITE_TOOL_NAMES.has("promote_to_base")).toBe(true);
    expect(routeAfterAgent([{ name: "promote_to_base" }], WRITE_TOOL_NAMES)).toBe("approval");
  });

  it("WRITE_TOOL_NAMES contains exactly the 3 Tier-B CRM tool names", () => {
    for (const n of EXPECTED_CRM_TIER_B_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });

  it("buildTools includes all 5 scenario write tool names", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const w of EXPECTED_SCENARIO_WRITE_TOOL_NAMES) {
      expect(names.has(w), `expected ${w} in buildTools output`).toBe(true);
    }
  });

  it("buildTools still includes Phase-1 read+compute tool names", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    expect(names.has("find_client")).toBe(true);
    expect(names.has("run_projection")).toBe(true);
  });

  it("has no duplicate tool names after adding write tools", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

it("Tier-B CRM writes are in WRITE_TOOL_NAMES; Tier-A writes are NOT", () => {
  for (const n of ["crm_delete_note", "crm_delete_task", "crm_create_tasks"]) expect(WRITE_TOOL_NAMES.has(n)).toBe(true);
  for (const n of ["crm_add_note","crm_log_activity","crm_create_task","crm_update_task","crm_complete_task","crm_post_task_comment"]) expect(WRITE_TOOL_NAMES.has(n)).toBe(false);
});

it("global task HITL split: create/delete gated, update/status/comment Tier-A", () => {
  for (const n of ["tasks_create", "tasks_delete"]) expect(WRITE_TOOL_NAMES.has(n)).toBe(true);
  for (const n of ["tasks_list", "tasks_detail", "firm_members", "tasks_update", "tasks_set_status", "tasks_comment"]) {
    expect(WRITE_TOOL_NAMES.has(n)).toBe(false);
  }
  expect(WRITE_TOOL_NAMES.has("create_task_for_client")).toBe(false); // retired
});

describe("buildTools (Phase 4 report tool)", () => {
  it("buildTools includes generate_report", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    expect(names.has("generate_report")).toBe(true);
  });

  it("generate_report is NOT a write tool (non-destructive enqueue, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("generate_report")).toBe(false);
  });

  it("search_planning_kb is NOT a write tool (read-only KB retrieval, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("search_planning_kb")).toBe(false);
  });

  it("extract_import is NOT a write tool (re-stages pending import only, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("extract_import")).toBe(false);
  });

  it("routes generate_report to tools (auto-apply, no approval gate)", () => {
    expect(routeAfterAgent([{ name: "generate_report" }], WRITE_TOOL_NAMES)).toBe("tools");
  });

  it("explain_projection_change is present, read-only, and routes to tools (not approval)", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    expect(names.has("explain_projection_change")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("explain_projection_change")).toBe(false);
    expect(routeAfterAgent([{ name: "explain_projection_change" }], WRITE_TOOL_NAMES)).toBe("tools");
  });

  it("break_down_projection_figure is present, read-only, routes to tools", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    expect(names.has("break_down_projection_figure")).toBe(true);
    expect(WRITE_TOOL_NAMES.has("break_down_projection_figure")).toBe(false);
    expect(routeAfterAgent([{ name: "break_down_projection_figure" }], WRITE_TOOL_NAMES)).toBe("tools");
  });
});

describe("buildTools (book bundle)", () => {
  it("includes the book bundle's single read tool", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    for (const n of EXPECTED_BOOK) expect(names).toContain(n);
  });

  it("scan_book is NOT a write tool (read-only, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("scan_book")).toBe(false);
  });
});

describe("buildTools (navigate bundle)", () => {
  it("includes the navigate bundle's single tool", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    for (const n of EXPECTED_NAVIGATE) expect(names).toContain(n);
  });

  it("open_page is NOT a write tool (non-destructive routing, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("open_page")).toBe(false);
  });

  it("routes open_page to tools (auto-apply, no approval gate)", () => {
    expect(routeAfterAgent([{ name: "open_page" }], WRITE_TOOL_NAMES)).toBe("tools");
  });

  it("cite_page is NOT a write tool (non-destructive linking, no HITL)", () => {
    expect(WRITE_TOOL_NAMES.has("cite_page")).toBe(false);
  });

  it("routes cite_page to tools (auto-apply, no approval gate)", () => {
    expect(routeAfterAgent([{ name: "cite_page" }], WRITE_TOOL_NAMES)).toBe("tools");
  });
});

describe("buildTools bundles", () => {
  it("buildTools() with no bundle arg returns the full set (unchanged count 67)", () => {
    expect(buildTools(TOOL_CTX)).toHaveLength(67);
  });

  it("buildTools(ctx, ['read']) returns only the read bundle", () => {
    const names = buildTools(TOOL_CTX, ["read"]).map((t) => t.name);
    const readNames = new Set(TOOL_BUNDLES.read(TOOL_CTX).map((t) => t.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => readNames.has(n))).toBe(true);
  });

  it("narrowing to a subset is strictly smaller than the full set", () => {
    expect(buildTools(TOOL_CTX, ["read", "memory"]).length).toBeLessThan(buildTools(TOOL_CTX).length);
  });
});

// ── Global tool set (clientless) ──────────────────────────────────────────────
// buildGlobalTools has no IO deps — no mocks needed beyond those already set.
describe("global tool set (clientless)", () => {
  const names = buildGlobalTools({ ctx: { userId: "u", firmId: "f" }, conversationId: "c" })
    .map((t) => t.name)
    .sort();
  it("is exactly the help + navigation + global-action + walkthrough + global-task set (19 tools)", () => {
    expect(names).toEqual([
      "build_plan", "cite_page", "create_household", "find_client", "firm_members", "get_help",
      "ingest_fact_finder", "open_client", "open_page", "search_help", "set_up_plan", "start_walkthrough",
      "tasks_comment", "tasks_create", "tasks_delete", "tasks_detail", "tasks_list",
      "tasks_set_status", "tasks_update",
    ]);
  });
});

describe("routeAfterAgent with WRITE_TOOL_NAMES", () => {
  it("routes a write tool call to approval", () => {
    expect(routeAfterAgent([{ name: "propose_changes" }], WRITE_TOOL_NAMES)).toBe("approval");
  });

  it("routes a read tool call to tools", () => {
    expect(routeAfterAgent([{ name: "find_client" }], WRITE_TOOL_NAMES)).toBe("tools");
  });

  it("routes empty tool calls to __end__", () => {
    expect(routeAfterAgent([], WRITE_TOOL_NAMES)).toBe("__end__");
  });

  // CRM routing
  it("routes crm_add_note (Tier-A) to tools (auto-apply, no HITL)", () => {
    expect(routeAfterAgent([{ name: "crm_add_note" }], WRITE_TOOL_NAMES)).toBe("tools");
  });

  it("routes crm_delete_task (Tier-B) to approval (HITL required)", () => {
    expect(routeAfterAgent([{ name: "crm_delete_task" }], WRITE_TOOL_NAMES)).toBe("approval");
  });
});
