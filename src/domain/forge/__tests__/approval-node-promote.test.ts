// src/domain/forge/__tests__/approval-node-promote.test.ts
//
// Phase-4 Task 14 — the promote_to_base HITL flow, exercised end-to-end through
// the REAL graph (real agent/approval nodes, real promote_to_base tool). A
// sibling to approval-node.test.ts: it reuses the SAME graph/checkpointer/resume
// mechanics, only the LLM script + write-path mocks differ (a promote_to_base
// tool call instead of propose_changes, plus a mock for the destructive
// promote-to-base orchestrator).
//
// What this proves — the inherited single-most-important rule, for the most
// dangerous write surface:
//   • PAUSED (no resume): promoteScenarioToBase NOT called; NO write_proposed
//     yet; the run surfaces an approval interrupt carrying the promote_to_base
//     call + its preview.
//   • CONFIRM (resume → approve): promoteScenarioToBase called EXACTLY ONCE; the
//     NODE records write_proposed exactly once; the TOOL records write_approved.
//   • REJECT (resume → decline): write_rejected recorded; promoteScenarioToBase
//     called ZERO times — nothing mutates.
//
// Audit ownership split (identical to the propose_changes case): the NODE owns
// write_proposed (post-interrupt, so once per proposal on the resume pass) and
// write_rejected; the TOOL owns write_approved (only on real persisted success).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { MemorySaver, Command } from "@langchain/langgraph";

// --- LLM: a scripted two-turn fake. Matches the real agent node, which calls
// chatModel().bindTools(tools).invoke(...). bindTools returns the same fake.
const PROMOTE_CALL = {
  id: "call_promote_1",
  name: "promote_to_base",
  args: { scenarioId: "s1" },
};
const invoke = vi
  .fn()
  // turn 1: propose a promote_to_base write → routes to the approval node
  .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [PROMOTE_CALL] }))
  // turn 2 (post-resume): plain answer → END
  .mockResolvedValue(new AIMessage("Done — promoted to base."));
vi.mock("../llm", () => ({
  chatModel: () => ({ bindTools: () => ({ invoke }) }),
}));

// --- Write-path IO for the REAL promote_to_base tool (success path). gateAccess
// → requireOrgId + verifyClientAccess; then a select(id,name,isBaseCase) row; then
// promoteScenarioToBase + recordAudit(write_approved).
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
// The destructive orchestrator — mocked so the confirm-path reaches success
// without touching a DB. Its return shape is what the tool reads into the
// write_approved audit metadata + the success ToolMessage.
vi.mock("@/lib/scenario/promote-to-base", () => ({
  promoteScenarioToBase: vi.fn(),
}));
// scenario-writes also imports these (other tools in the same module); stub so
// the module loads. The promote tool itself uses none of them.
vi.mock("@/lib/scenario/changes-writer", () => ({
  applyEntityAdd: vi.fn(),
  applyEntityEdit: vi.fn(),
  applyEntityRemove: vi.fn(),
  revertChange: vi.fn(),
}));
vi.mock("@/lib/scenario/create-with-clone", () => ({ createScenarioWithClone: vi.fn() }));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: vi.fn() }));
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({ loadProjectionForRef: vi.fn() }));
vi.mock("@/db", () => {
  // The promote tool's gate select:
  //   db.select({id,name,isBaseCase}).from(scenarios).where(and(...)) → [row]
  // Return ONE non-base row so the tool proceeds to promoteScenarioToBase.
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Promise.resolve([{ id: "s1", name: "Aggressive Roth", isBaseCase: false }]),
          ),
        })),
      })),
    },
  };
});
// Preview enrichment is best-effort (try/catch in describeProposedWrite). For
// promote_to_base it first awaits loadEffectiveTree(...,"base",...); force that to
// reject so the node falls back to the pure summary (previews.length stays 1) and
// never blocks on a real load/projection. The promote TOOL does NOT import the
// loader, so the confirm-path write is unaffected.
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(() => Promise.reject(new Error("no db in test"))),
}));
// CRM tool deps — needed because buildGraph → buildTools includes CRM tools.
vi.mock("@/lib/crm/notes", () => ({ createNote: vi.fn(), listHouseholdNotes: vi.fn(), deleteNote: vi.fn() }));
vi.mock("@/lib/crm/schemas", () => ({ createCrmNoteSchema: { parse: vi.fn() } }));
vi.mock("@/lib/crm/activity", () => ({ recordActivity: vi.fn(), listActivity: vi.fn() }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: vi.fn(), getTaskById: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn(), updateTaskField: vi.fn(), setTaskStatus: vi.fn(), postComment: vi.fn(), deleteTask: vi.fn() }));
vi.mock("@/lib/crm-tasks/schemas", () => ({ createCrmTaskSchema: { parse: vi.fn(), omit: () => ({ parse: vi.fn() }) } }));
vi.mock("@/lib/overview/list-open-items", () => ({ listOpenItems: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({ getCrmHousehold: vi.fn() }));
vi.mock("@/lib/overview/get-overview-data", () => ({ getOverviewData: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ computeAlerts: vi.fn() }));
vi.mock("../guards", () => ({ clientToHousehold: vi.fn(), assertHouseholdReadable: vi.fn() }));
vi.mock("../account-mask", () => ({ maskSsnLast4: vi.fn() }));

import { buildGraph } from "../graph";
import type { ForgeAuthContext } from "../state";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { promoteScenarioToBase } from "@/lib/scenario/promote-to-base";

const ctx: ForgeAuthContext = {
  userId: "user_1",
  firmId: "org_session",
  clientId: "client_1",
  scenarioId: "scenario_1",
};

function build(threadId: string) {
  return buildGraph(ctx, new MemorySaver(), threadId, () => "SYSTEM");
}

beforeEach(() => {
  vi.clearAllMocks();
  invoke
    .mockReset()
    .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [PROMOTE_CALL] }))
    .mockResolvedValue(new AIMessage("Done — promoted to base."));
  vi.mocked(requireOrgId).mockResolvedValue("org_session");
  vi.mocked(verifyClientAccess).mockResolvedValue(true);
  vi.mocked(recordAudit).mockResolvedValue(undefined);
  vi.mocked(promoteScenarioToBase).mockResolvedValue({
    snapshotId: "snap1",
    deletedScenarioCount: 2,
    counts: {},
    notes: { kept: 0, dropped: 0 },
    // PromoteResult is a richer shape; this satisfies the fields the tool reads
    // (snapshotId + deletedScenarioCount). Cast to keep the test focused.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

describe("approval node — promote_to_base (destructive scenario write)", () => {
  it("pauses on a promote turn: builds a preview, runs no promote, defers write_proposed", async () => {
    const g = build("promote-conv-pause");
    const result = await g.invoke(
      { messages: [new HumanMessage("make the Aggressive Roth scenario the base")], authContext: ctx },
      { configurable: { thread_id: "promote-conv-pause" }, recursionLimit: 10 },
    );

    // The destructive promote has NOT executed — we're paused at the interrupt.
    expect(promoteScenarioToBase).not.toHaveBeenCalled();

    // The run surfaced an approval interrupt with one preview + the promote call.
    // __interrupt__ is added by LangGraph at runtime and isn't on the compiled
    // graph's static state type, so read it through a narrow cast.
    const interrupts = (result as { __interrupt__?: Array<{ value: unknown }> })
      .__interrupt__;
    expect(interrupts).toBeDefined();
    const payload = interrupts![0].value as {
      type: string;
      previews: Array<{ name: string }>;
      calls: Array<{ id: string; name: string }>;
    };
    expect(payload.type).toBe("approval_required");
    expect(payload.previews).toHaveLength(1);
    expect(payload.previews[0].name).toBe("promote_to_base");
    expect(payload.calls[0]).toMatchObject({ id: "call_promote_1", name: "promote_to_base" });

    // write_proposed is recorded AFTER interrupt(), so on this first (paused,
    // no-resume) pass it has NOT fired yet — interrupt() threw before reaching the
    // audit loop. It records once on the resume pass (Tests 2 & 3).
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_proposed" }),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("confirm: runs promoteScenarioToBase exactly once; write_approved comes from the TOOL", async () => {
    const g = build("promote-conv-confirm");
    const cfg = { configurable: { thread_id: "promote-conv-confirm" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("make the Aggressive Roth scenario the base")], authContext: ctx },
      cfg,
    );

    await g.invoke(new Command({ resume: { decisions: { call_promote_1: "confirm" } } }), cfg);

    // The real promote_to_base tool ran the orchestrator exactly once.
    expect(promoteScenarioToBase).toHaveBeenCalledTimes(1);
    // write_proposed fires EXACTLY ONCE across the propose + resume passes — the
    // audit loop is after interrupt(), so the pre-resume pass never records it.
    expect(
      vi.mocked(recordAudit).mock.calls.filter(([a]) => a.action === "copilot.write_proposed"),
    ).toHaveLength(1);
    // write_approved is emitted by the TOOL on success, never by the node.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        metadata: expect.objectContaining({ tool: "promote_to_base", snapshotId: "snap1" }),
      }),
    );
  });

  it("reject: skips the promote, audits write_rejected, pushes a decline ToolMessage", async () => {
    const g = build("promote-conv-reject");
    const cfg = { configurable: { thread_id: "promote-conv-reject" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("make the Aggressive Roth scenario the base")], authContext: ctx },
      cfg,
    );

    const out = await g.invoke(
      new Command({ resume: { decisions: { call_promote_1: "reject" } } }),
      cfg,
    );

    // No promote ran — nothing mutated.
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
    // write_proposed fires EXACTLY ONCE (on the resume pass), independent of the
    // reject verdict — the node audits every proposed write, confirm or decline.
    expect(
      vi.mocked(recordAudit).mock.calls.filter(([a]) => a.action === "copilot.write_proposed"),
    ).toHaveLength(1);
    // The node audited the rejection.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_rejected",
        clientId: "client_1",
        firmId: "org_session",
        metadata: expect.objectContaining({ tool: "promote_to_base", toolCallId: "call_promote_1" }),
      }),
    );
    // The tool never claimed approval.
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
    // The decline message is in the thread.
    const declined = out.messages.find(
      (m): m is ToolMessage =>
        m instanceof ToolMessage && m.content === "User declined this action.",
    );
    expect(declined).toBeDefined();
  });
});
