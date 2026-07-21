// src/domain/forge/__tests__/approval-node-custom-events.test.ts
//
// THE MISSING COVERAGE: nothing asserted that a custom event emitted by an
// APPROVAL-GATED tool actually reaches streamEvents. Read tools were covered
// only incidentally (they run through `toolsNode`), and that asymmetry is what
// let a whole class of bug hide — `build_plan`'s attach-files paperclip and
// `create_household`/`set_up_plan`'s post-write navigation ALL ride on this
// seam, and all of them run from the approval node, never from toolsNode.
//
// Two mechanisms can carry that frame out of the node (see the invokeTool note
// in graph.ts). These tests deliberately assert the OUTCOME — the frame reached
// the stream — rather than either mechanism, so they stay honest if the graph's
// internals change; they are the only thing that would catch it if both broke.
//
// This file isolates the GRAPH seam with synthetic tools (no DB, no model).
// Its sibling, global-build-plan-frame.test.ts, pins the same seam through the
// REAL build_plan tool — they are separate files because this one mocks
// WRITE_TOOL_NAMES down to the fake write, which would knock build_plan out of
// the write set and route it around the approval node entirely.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver, Command } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { emitToolRender } from "../custom-events";
import { toolRenderNames } from "./custom-event-helpers";

// --- Synthetic tool set. Mocking `../tools` wholesale gives us BOTH the tool
// list and the write-name set the graph routes on, so the fake write really does
// land in the approval node.
const fakeWrite = tool(
  async () => {
    await emitToolRender("fake_write", "complete", { ok: true });
    return JSON.stringify({ ok: true });
  },
  {
    name: "fake_write",
    description: "A write tool that emits a tool_render frame.",
    schema: z.object({}),
  },
);
const fakeRead = tool(
  async () => {
    await emitToolRender("fake_read", "complete", { ok: true });
    return JSON.stringify({ ok: true });
  },
  {
    name: "fake_read",
    description: "A read tool that emits a tool_render frame.",
    schema: z.object({}),
  },
);
vi.mock("../tools", () => ({
  buildTools: () => [fakeWrite, fakeRead],
  WRITE_TOOL_NAMES: new Set(["fake_write"]),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
// describeProposedWrite's enrichment is best-effort; keep it off the DB.
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(() => Promise.reject(new Error("no db in test"))),
}));

const WRITE_CALL = { id: "call_w", name: "fake_write", args: {} };
const READ_CALL = { id: "call_r", name: "fake_read", args: {} };

const invoke = vi.fn();
vi.mock("../llm", () => ({
  chatModel: () => ({ bindTools: () => ({ invoke }) }),
}));

import { buildGraph } from "../graph";
import type { ForgeAuthContext } from "../state";

const ctx: ForgeAuthContext = {
  userId: "user_1",
  firmId: "org_session",
  clientId: "client_1",
  scenarioId: "scenario_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockReset();
});

describe("HITL nodes thread the runnable config into tool invocations", () => {
  it("surfaces a custom event emitted by an APPROVAL-GATED write tool", async () => {
    invoke
      .mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [WRITE_CALL] }))
      .mockResolvedValue(new AIMessage("Done."));

    const g = buildGraph(ctx, new MemorySaver(), "conv-ce-write", () => "SYSTEM");
    const cfg = { configurable: { thread_id: "conv-ce-write" }, recursionLimit: 10 };

    // Pass 1 runs to the interrupt — nothing has executed yet.
    const proposeFrames = await toolRenderNames(
      g.streamEvents(
        { messages: [new HumanMessage("do the write")], authContext: ctx },
        { ...cfg, version: "v2" },
      ),
    );
    expect(proposeFrames).toEqual([]);

    // Pass 2 (resume, confirmed) actually runs the tool. Its frame MUST reach
    // the stream — this is the assertion that was missing, and the one that
    // fails when approvalNode drops config.
    const resumeFrames = await toolRenderNames(
      g.streamEvents(new Command({ resume: { decisions: { call_w: "confirm" } } }), {
        ...cfg,
        version: "v2",
      }),
    );
    expect(resumeFrames).toContain("fake_write");
  });

  it("surfaces a custom event from a READ call batched into a write turn", async () => {
    // A read mixed into a write turn is executed inline by the approval node's
    // else-branch rather than by toolsNode, so it needs the same threading.
    invoke
      .mockResolvedValueOnce(
        new AIMessage({ content: "", tool_calls: [WRITE_CALL, READ_CALL] }),
      )
      .mockResolvedValue(new AIMessage("Done."));

    const g = buildGraph(ctx, new MemorySaver(), "conv-ce-read", () => "SYSTEM");
    const cfg = { configurable: { thread_id: "conv-ce-read" }, recursionLimit: 10 };

    await toolRenderNames(
      g.streamEvents(
        { messages: [new HumanMessage("do both")], authContext: ctx },
        { ...cfg, version: "v2" },
      ),
    );
    const resumeFrames = await toolRenderNames(
      g.streamEvents(new Command({ resume: { decisions: { call_w: "reject" } } }), {
        ...cfg,
        version: "v2",
      }),
    );
    // The write was declined, so only the read ran — and its frame must ship.
    expect(resumeFrames).toContain("fake_read");
    expect(resumeFrames).not.toContain("fake_write");
  });
});
