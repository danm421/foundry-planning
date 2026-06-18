import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Fake model that ALWAYS calls loop_tool — drives the consecutive-failure path.
let turn = 0;
const modelInvoke = vi.fn(
  async () =>
    new AIMessage({ content: "", tool_calls: [{ id: `call_${turn++}`, name: "loop_tool", args: {} }] }),
);
vi.mock("../llm", () => ({
  chatModel: () => ({ bindTools: () => ({ invoke: modelInvoke }) }),
  embeddings: vi.fn(),
}));

// A read tool (not in WRITE_TOOL_NAMES → routes to "tools") that always returns
// a sanitized error object — counted as a failure by isToolFailure.
const toolInvoke = vi.fn(async () => JSON.stringify({ error: "boom" }));
const loopTool = tool(toolInvoke, {
  name: "loop_tool",
  description: "always fails",
  schema: z.object({}),
});
vi.mock("../tools", () => ({
  buildTools: () => [loopTool],
  WRITE_TOOL_NAMES: new Set<string>(),
}));

import { buildGraph } from "../graph";
import type { ForgeAuthContext } from "../state";

const authContext: ForgeAuthContext = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };

describe("consecutive-error escalation", () => {
  it("ends at the escalate node after 3 consecutive failures of one tool", async () => {
    const g = buildGraph(authContext, new MemorySaver(), "conv-esc", () => "SYSTEM");
    const out = await g.invoke(
      { messages: [new HumanMessage("do the thing")], authContext },
      { configurable: { thread_id: "conv-esc" }, recursionLimit: 25 },
    );
    const last = out.messages[out.messages.length - 1] as AIMessage;
    expect(String(last.content)).toMatch(/keep hitting an error/i);
    // The loop is cut off at the threshold — the tool didn't run a 4th time.
    expect(toolInvoke).toHaveBeenCalledTimes(3);
  });
});
