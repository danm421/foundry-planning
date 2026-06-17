// src/domain/copilot/__tests__/graph.test.ts
import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

// Mock the model so the test never touches Azure. bindTools() returns the same
// fake; invoke() returns a final answer with NO tool calls.
const invoke = vi.fn(async () => new AIMessage("The plan funds through age 95."));
vi.mock("../llm", () => ({
  chatModel: () => ({ bindTools: () => ({ invoke }) }),
}));
// Phase 0: no tools.
vi.mock("../tools", () => ({
  buildTools: () => [],
  WRITE_TOOL_NAMES: new Set<string>(),
}));

import { buildGraph } from "../graph";
import type { CopilotAuthContext } from "../state";

const authContext: CopilotAuthContext = {
  userId: "u1",
  firmId: "org_A",
  clientId: "c1",
  scenarioId: "base",
};

describe("buildGraph", () => {
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
    expect(last.content).toBe("The plan funds through age 95.");
    // human + assistant only — no tool round-trip happened
    expect(out.messages).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
