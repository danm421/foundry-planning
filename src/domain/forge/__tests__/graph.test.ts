// src/domain/forge/__tests__/graph.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

// invoke() returns a final answer with NO tool calls. Default answer has NO
// number so the plain agent→END test doesn't trigger the verify branch.
const invoke = vi.fn(async () => new AIMessage("The plan is on track."));
const criticInvoke = vi.fn(async () => ({ ok: true, problems: [] }));
// A spy, not a bare arrow: how MANY times a turn builds a model is a real cost
// claim now that chatModel() resolves per-firm credentials and, for a firm in
// its own Azure tenant, reads its connection row.
const chatModel = vi.fn(() => ({
  bindTools: () => ({ invoke }),
  withStructuredOutput: () => ({ invoke: criticInvoke }),
}));
vi.mock("../llm", () => ({ chatModel: () => chatModel() }));
// Phase 0: no tools. Typed so the spy RECORDS both arguments — the tiering test
// asserts which bundles were asked for, which a zero-arg spy would not capture.
const buildTools = vi.fn<(ctx: unknown, bundles?: readonly string[]) => never[]>(() => []);
vi.mock("../tools", () => ({
  buildTools: (ctx: unknown, bundles?: readonly string[]) => buildTools(ctx, bundles),
  WRITE_TOOL_NAMES: new Set<string>(),
}));
const classifyIntent = vi.fn<(text: string) => Promise<string[]>>(async () => ["read"]);
vi.mock("../dispatcher", () => ({
  classifyIntent: (text: string) => classifyIntent(text),
}));

import { buildGraph } from "../graph";
import type { ForgeAuthContext } from "../state";

const authContext: ForgeAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "c1",
  scenarioId: "base",
};

describe("buildGraph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compiles into an invokable graph", () => {
    const g = buildGraph(authContext, new MemorySaver(), "conv-1", () => "SYSTEM");
    expect(typeof g.invoke).toBe("function");
    expect(typeof g.streamEvents).toBe("function");
  });

  it("routes a no-tool message agent -> END and appends one assistant message", async () => {
    const g = buildGraph(authContext, new MemorySaver(), "conv-2", () => "SYSTEM");
    const out = await g.invoke(
      { messages: [new HumanMessage("how is the plan tracking?")], authContext },
      { configurable: { thread_id: "conv-2" }, recursionLimit: 10 },
    );
    const last = out.messages[out.messages.length - 1] as AIMessage;
    expect(last).toBeInstanceOf(AIMessage);
    expect(last.content).toBe("The plan is on track.");
    // human + assistant only — no tool round-trip happened
    expect(out.messages).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("routes a number answer through verify and exhausts to a caveat", async () => {
    invoke.mockResolvedValue(new AIMessage("Funds to $2.5M.")); // ungrounded → Tier 1 fails
    const g = buildGraph(authContext, new MemorySaver(), "conv-3", () => "SYSTEM");
    const out = await g.invoke(
      { messages: [new HumanMessage("how big is the nest egg?")], authContext, verifyAttempts: 0 },
      { configurable: { thread_id: "conv-3" }, recursionLimit: 15 },
    );
    // agent (draft) → verify (retry) → agent (redraft) → verify (caveat) → END
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(out.verifyAttempts).toBe(1);
    expect(out.verifyDecision).toBe("caveat");
  });

  it("under tool tiering, builds ONE model per turn instead of one it discards", async () => {
    // The classifier decides WHICH tools, then the model is built once and bound
    // to them. Building a full-tool model first and overwriting it after the
    // classifier returned cost a credential resolve and — for a firm running in
    // its own Azure tenant — a connection read, every tiered turn, for an object
    // that was thrown away. Nothing watched the flag at all before this.
    vi.stubEnv("FORGE_TIERING_ENABLED", "true");
    invoke.mockResolvedValue(new AIMessage("The plan is on track."));
    try {
      const g = buildGraph(authContext, new MemorySaver(), "conv-4", () => "SYSTEM");
      // buildGraph itself builds the default tool set; count only the turn.
      chatModel.mockClear();
      buildTools.mockClear();

      await g.invoke(
        { messages: [new HumanMessage("what changed this month?")], authContext },
        { configurable: { thread_id: "conv-4" }, recursionLimit: 10 },
      );

      expect(chatModel).toHaveBeenCalledTimes(1);
      // And it was bound to the CLASSIFIED bundles, so the single build is the
      // tiered one — not the full-tool model with the classifier skipped.
      expect(classifyIntent).toHaveBeenCalledWith("what changed this month?");
      expect(buildTools).toHaveBeenCalledWith(expect.anything(), ["read"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("skips the classifier entirely when tiering is off", async () => {
    invoke.mockResolvedValue(new AIMessage("The plan is on track."));
    const g = buildGraph(authContext, new MemorySaver(), "conv-5", () => "SYSTEM");
    chatModel.mockClear();

    await g.invoke(
      { messages: [new HumanMessage("what changed this month?")], authContext },
      { configurable: { thread_id: "conv-5" }, recursionLimit: 10 },
    );

    expect(classifyIntent).not.toHaveBeenCalled();
    expect(chatModel).toHaveBeenCalledTimes(1);
  });
});
