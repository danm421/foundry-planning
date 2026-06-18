// src/domain/forge/__tests__/graph.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

// invoke() returns a final answer with NO tool calls. Default answer has NO
// number so the plain agent→END test doesn't trigger the verify branch.
const invoke = vi.fn(async () => new AIMessage("The plan is on track."));
const criticInvoke = vi.fn(async () => ({ ok: true, problems: [] }));
vi.mock("../llm", () => ({
  chatModel: () => ({
    bindTools: () => ({ invoke }),
    withStructuredOutput: () => ({ invoke: criticInvoke }),
  }),
}));
// Phase 0: no tools.
vi.mock("../tools", () => ({
  buildTools: () => [],
  WRITE_TOOL_NAMES: new Set<string>(),
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
});
