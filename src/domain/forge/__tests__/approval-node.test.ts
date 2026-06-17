// src/domain/forge/__tests__/approval-node.test.ts
//
// Phase-2 Task 61 — the approval node's audit + preview behaviour, exercised
// end-to-end through the REAL graph (real agent/approval nodes, real tools).
//
// The model is faked so the run is deterministic: turn 1 emits one
// `propose_changes` write call; on resume turn 2 emits a plain message so the
// graph terminates. The write-path IO is mocked so the REAL propose_changes
// tool reaches success on confirm.
//
// Audit ownership split under test:
//   • the NODE emits copilot.write_proposed (post-interrupt, so it fires once per
//     proposal — only on the resume pass) and, on a decline, copilot.write_rejected;
//   • the write TOOL emits copilot.write_approved — only on a real success.
// So a confirm run shows write_approved coming from the tool (not the node), and a
// paused run (no resume) shows NO write_proposed yet.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { MemorySaver, Command } from "@langchain/langgraph";

// --- LLM: a scripted two-turn fake. Matches the real agent node, which calls
// chatModel().bindTools(tools).invoke(...). bindTools returns the same fake.
const WRITE_CALL = {
  id: "call_1",
  name: "propose_changes",
  args: {
    scenarioId: "scenario_1",
    groupName: "Delay SS to 70",
    changes: [
      {
        opType: "edit",
        targetKind: "plan_settings",
        targetId: "plan_settings",
        desiredFields: { ssClaimAgePrimary: 70 },
      },
    ],
  },
};
const invoke = vi
  .fn()
  // turn 1: propose a write → routes to the approval node
  .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [WRITE_CALL] }))
  // turn 2 (post-resume): plain answer → END
  .mockResolvedValue(new AIMessage("Done — applied the change."));
vi.mock("../llm", () => ({
  chatModel: () => ({ bindTools: () => ({ invoke }) }),
}));

// --- Write-path IO for the REAL propose_changes tool (success path). Mirrors
// scenario-writes.test.ts.
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/scenario/changes-writer", () => ({
  applyEntityAdd: vi.fn(),
  applyEntityEdit: vi.fn(),
  applyEntityRemove: vi.fn(),
  revertChange: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => {
  const insertChain = () => ({
    values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: "tg-new" }])) })),
  });
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Promise.resolve([{ id: "scenario_1", clientId: "client_1" }]),
          ),
        })),
      })),
      insert: vi.fn(insertChain),
      // propose_changes mints + applies the batch inside one transaction.
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert: vi.fn(insertChain) }),
      ),
    },
  };
});
// Preview enrichment is best-effort (try/catch in describeProposedWrite). Force
// it to fail fast so the node falls back to the pure summary (previews.length
// stays 1) and the test never blocks on a real load/projection. The
// propose_changes tool does NOT import the loader, so the confirm-path write is
// unaffected.
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(() => Promise.reject(new Error("no db in test"))),
}));
// CRM tool deps — needed because buildGraph → buildTools now includes CRM tools
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
import { applyEntityEdit } from "@/lib/scenario/changes-writer";
import { recordAudit } from "@/lib/audit";
import { deleteTask } from "@/lib/crm-tasks/mutations";
import { getTaskById } from "@/lib/crm-tasks/queries";
import { clientToHousehold } from "../guards";

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
    .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [WRITE_CALL] }))
    .mockResolvedValue(new AIMessage("Done — applied the change."));
  vi.mocked(requireOrgId).mockResolvedValue("org_session");
  vi.mocked(verifyClientAccess).mockResolvedValue(true);
  vi.mocked(recordAudit).mockResolvedValue(undefined);
  vi.mocked(applyEntityEdit).mockResolvedValue(undefined);
});

describe("approval node", () => {
  it("pauses on a write turn: builds a preview, runs no write, defers write_proposed", async () => {
    const g = build("conv-pause");
    const result = await g.invoke(
      { messages: [new HumanMessage("delay social security to 70")], authContext: ctx },
      { configurable: { thread_id: "conv-pause" }, recursionLimit: 10 },
    );

    // The write has NOT executed — we're paused at the interrupt.
    expect(applyEntityEdit).not.toHaveBeenCalled();

    // The run surfaced an approval interrupt with one preview + the write call.
    // __interrupt__ is added by LangGraph at runtime and isn't on the compiled
    // graph's static state type, so read it through a narrow cast.
    const interrupts = (result as { __interrupt__?: Array<{ value: unknown }> })
      .__interrupt__;
    expect(interrupts).toBeDefined();
    const payload = interrupts![0].value as {
      type: string;
      previews: unknown[];
      calls: Array<{ id: string; name: string }>;
    };
    expect(payload.type).toBe("approval_required");
    expect(payload.previews).toHaveLength(1);
    expect(payload.calls[0]).toMatchObject({ id: "call_1", name: "propose_changes" });

    // write_proposed is now recorded AFTER interrupt(), so on this first
    // (paused, no-resume) pass it has NOT fired yet — interrupt() threw before
    // reaching the audit loop. It records once on the resume pass (Tests 2 & 3).
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_proposed" }),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("confirm: runs the real write exactly once; write_approved comes from the TOOL", async () => {
    const g = build("conv-confirm");
    const cfg = { configurable: { thread_id: "conv-confirm" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("delay social security to 70")], authContext: ctx },
      cfg,
    );

    await g.invoke(new Command({ resume: { decisions: { call_1: "confirm" } } }), cfg);

    // The real propose_changes tool ran exactly once.
    expect(applyEntityEdit).toHaveBeenCalledTimes(1);
    // write_proposed fires EXACTLY ONCE across the propose + resume passes — the
    // audit loop is now after interrupt(), so the pre-resume pass never records it.
    expect(
      vi.mocked(recordAudit).mock.calls.filter(([a]) => a.action === "copilot.write_proposed"),
    ).toHaveLength(1);
    // write_approved is emitted by the TOOL on success, never by the node.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        metadata: expect.objectContaining({ tool: "propose_changes" }),
      }),
    );
  });

  it("reject: skips the write, audits write_rejected, pushes a decline ToolMessage", async () => {
    const g = build("conv-reject");
    const cfg = { configurable: { thread_id: "conv-reject" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("delay social security to 70")], authContext: ctx },
      cfg,
    );

    const out = await g.invoke(
      new Command({ resume: { decisions: { call_1: "reject" } } }),
      cfg,
    );

    // No write ran.
    expect(applyEntityEdit).not.toHaveBeenCalled();
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
        metadata: expect.objectContaining({ tool: "propose_changes", toolCallId: "call_1" }),
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

// ─── Task 24: crm_delete_task Tier-B approval-node integration ──────────────
//
// Confirms the inherited audit/HITL machinery works for CRM Tier-B writes.
// Mirrors the propose_changes tests above: same graph/interrupt harness,
// only the tool name + args differ.
//
// The crm_delete_task tool: gateCrm → assertTaskInHousehold → deleteTask →
//   recordAudit(write_approved). The node owns write_proposed/write_rejected.

const CRM_DELETE_CALL = {
  id: "call_crm_1",
  name: "crm_delete_task",
  args: { taskId: "task_abc" },
};

describe("approval node — crm_delete_task (Tier-B CRM write)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the main invoke mock (used by propose_changes tests above) to avoid
    // cross-test pollution, then configure it for the CRM scenario.
    invoke
      .mockReset()
      .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [CRM_DELETE_CALL] }))
      .mockResolvedValue(new AIMessage("Done — task deleted."));
    vi.mocked(requireOrgId).mockResolvedValue("org_session");
    vi.mocked(verifyClientAccess).mockResolvedValue(true);
    vi.mocked(clientToHousehold).mockResolvedValue("hh_1");
    vi.mocked(recordAudit).mockResolvedValue(undefined);
    // assertTaskInHousehold checks getTaskById then compares householdId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getTaskById).mockResolvedValue({ task: { id: "task_abc", householdId: "hh_1" } as any, tags: [] });
    vi.mocked(deleteTask).mockResolvedValue(undefined);
  });

  it("pauses on a crm_delete_task write turn — no delete runs, write_proposed deferred", async () => {
    const g = build("crm-conv-pause");
    const result = await g.invoke(
      { messages: [new HumanMessage("delete task task_abc")], authContext: ctx },
      { configurable: { thread_id: "crm-conv-pause" }, recursionLimit: 10 },
    );

    // The write has NOT executed.
    expect(deleteTask).not.toHaveBeenCalled();

    const interrupts = (result as { __interrupt__?: Array<{ value: unknown }> })
      .__interrupt__;
    expect(interrupts).toBeDefined();
    const payload = interrupts![0].value as {
      type: string;
      calls: Array<{ id: string; name: string }>;
    };
    expect(payload.type).toBe("approval_required");
    expect(payload.calls[0]).toMatchObject({ id: "call_crm_1", name: "crm_delete_task" });

    // write_proposed not yet fired (fires after interrupt() on the resume pass).
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_proposed" }),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("confirm: runs deleteTask once; write_approved comes from the TOOL", async () => {
    const g = build("crm-conv-confirm");
    const cfg = { configurable: { thread_id: "crm-conv-confirm" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("delete task task_abc")], authContext: ctx },
      cfg,
    );
    await g.invoke(new Command({ resume: { decisions: { call_crm_1: "confirm" } } }), cfg);

    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(recordAudit).mock.calls.filter(([a]) => a.action === "copilot.write_proposed"),
    ).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        metadata: expect.objectContaining({ tool: "crm_delete_task" }),
      }),
    );
  });

  it("reject: skips deleteTask, audits write_rejected, pushes decline ToolMessage", async () => {
    const g = build("crm-conv-reject");
    const cfg = { configurable: { thread_id: "crm-conv-reject" }, recursionLimit: 10 };
    await g.invoke(
      { messages: [new HumanMessage("delete task task_abc")], authContext: ctx },
      cfg,
    );
    const out = await g.invoke(
      new Command({ resume: { decisions: { call_crm_1: "reject" } } }),
      cfg,
    );

    expect(deleteTask).not.toHaveBeenCalled();
    expect(
      vi.mocked(recordAudit).mock.calls.filter(([a]) => a.action === "copilot.write_proposed"),
    ).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_rejected",
        metadata: expect.objectContaining({ tool: "crm_delete_task", toolCallId: "call_crm_1" }),
      }),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
    const declined = out.messages.find(
      (m): m is ToolMessage =>
        m instanceof ToolMessage && m.content === "User declined this action.",
    );
    expect(declined).toBeDefined();
  });
});
