// src/domain/copilot/__tests__/tools-index.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildToolContext } from "../context";
import type { CopilotAuthContext } from "../state";

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
// CRM tool deps (assembly test stays pure — no DB, no CRM IO)
vi.mock("@/lib/crm/notes", () => ({ createNote: vi.fn(), listHouseholdNotes: vi.fn(), deleteNote: vi.fn() }));
vi.mock("@/lib/crm/schemas", () => ({ createCrmNoteSchema: { parse: vi.fn() } }));
vi.mock("@/lib/crm/activity", () => ({ recordActivity: vi.fn(), listActivity: vi.fn() }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: vi.fn(), getTaskById: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn(), updateTaskField: vi.fn(), setTaskStatus: vi.fn(), postComment: vi.fn(), deleteTask: vi.fn() }));
vi.mock("@/lib/crm-tasks/schemas", () => ({ createCrmTaskSchema: { parse: vi.fn() } }));
vi.mock("@/lib/overview/list-open-items", () => ({ listOpenItems: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({ getCrmHousehold: vi.fn() }));
vi.mock("@/lib/overview/get-overview-data", () => ({ getOverviewData: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ computeAlerts: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("../guards", () => ({ clientToHousehold: vi.fn(), assertHouseholdReadable: vi.fn() }));
vi.mock("../account-mask", () => ({ maskSsnLast4: vi.fn() }));

import { buildTools, WRITE_TOOL_NAMES } from "../tools";
import { routeAfterAgent } from "../routing";

const ctx: CopilotAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const TOOL_CTX = buildToolContext(ctx, "conv-1");

const EXPECTED_PHASE1 = [
  // read
  "find_client",
  "client_briefing",
  "list_scenarios",
  "read_detail",
  // compute
  "run_projection",
  "run_monte_carlo",
  "compare_scenarios",
  "explain_report",
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
];

const EXPECTED_DETAIL_WRITE_TOOL_NAMES = [
  "add_expense",
  "update_expense",
  "remove_expense",
  "add_income",
  "update_income",
  "remove_income",
];

const EXPECTED_CRM_TIER_B_TOOL_NAMES = [
  "crm_create_tasks",
  "crm_delete_note",
  "crm_delete_task",
];

const EXPECTED_CRM_ALL_19 = [
  // read (4)
  "crm_client_card",
  "crm_recent_notes",
  "crm_list_tasks",
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

describe("buildTools (Phase 1 + Phase 2 + Phase 3 assembly)", () => {
  it("returns exactly the 44 named tools (15 Phase-1 + 4 scenario writes + 6 detail writes + 19 CRM)", () => {
    const tools = buildTools(TOOL_CTX);
    const names = new Set(tools.map((t) => t.name));
    // Phase-1, scenario-write, and detail-write tools all present
    for (const n of [
      ...EXPECTED_PHASE1,
      ...EXPECTED_SCENARIO_WRITE_TOOL_NAMES,
      ...EXPECTED_DETAIL_WRITE_TOOL_NAMES,
    ]) {
      expect(names.has(n), `expected ${n} in buildTools output`).toBe(true);
    }
    expect(tools).toHaveLength(44);
  });

  it("buildTools includes the 6 detail-write (expense + income) tool names", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_DETAIL_WRITE_TOOL_NAMES) {
      expect(names.has(n), `expected detail-write tool ${n} in buildTools output`).toBe(true);
    }
  });

  it("buildTools includes all 19 CRM tools by name", () => {
    const names = new Set(buildTools(TOOL_CTX).map((t) => t.name));
    for (const n of EXPECTED_CRM_ALL_19) {
      expect(names.has(n), `expected CRM tool ${n} in buildTools output`).toBe(true);
    }
  });

  it("has no duplicate tool names", () => {
    const names = buildTools(TOOL_CTX).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("WRITE_TOOL_NAMES is a non-empty Set (13 entries: 4 scenario writes + 6 detail writes + 3 Tier-B CRM writes)", () => {
    expect(WRITE_TOOL_NAMES instanceof Set).toBe(true);
    expect(WRITE_TOOL_NAMES.size).toBe(13);
  });

  it("WRITE_TOOL_NAMES contains the 6 detail-write (expense + income) tool names", () => {
    for (const n of EXPECTED_DETAIL_WRITE_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });
});

describe("buildTools + WRITE_TOOL_NAMES (Phase 2 scenario writes)", () => {
  it("WRITE_TOOL_NAMES contains exactly the 4 scenario-write tool names", () => {
    for (const n of EXPECTED_SCENARIO_WRITE_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });

  it("WRITE_TOOL_NAMES contains exactly the 3 Tier-B CRM tool names", () => {
    for (const n of EXPECTED_CRM_TIER_B_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES.has(n), `expected ${n} in WRITE_TOOL_NAMES`).toBe(true);
    }
  });

  it("buildTools includes all 4 scenario write tool names", () => {
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
