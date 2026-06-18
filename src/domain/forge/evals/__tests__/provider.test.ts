import { describe, it, expect, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";

// Mirror the graph.test.ts mock so no live Clerk/DB/Azure is touched. The model
// must return AIMessage instances (the messages reducer coerces them); a plain
// object fails MESSAGE_COERCION.
vi.mock("@/domain/forge/llm", () => ({
  chatModel: () => ({
    bindTools: () => ({
      // Deterministic fake: emit one add_expense tool call, then a final answer.
      invoke: vi
        .fn()
        .mockResolvedValueOnce(
          new AIMessage({
            content: "",
            tool_calls: [{ id: "t1", name: "add_expense", args: { label: "Gym", annualAmount: 1200 } }],
          }),
        )
        .mockResolvedValueOnce(new AIMessage({ content: "Done.", tool_calls: [] })),
    }),
  }),
  embeddings: vi.fn(),
}));

import { runForgeTurn } from "../provider";

describe("runForgeTurn", () => {
  it("returns the final text and the tool-call trajectory", async () => {
    const { output, trajectory } = await runForgeTurn("Add a $1,200/yr gym expense");
    expect(trajectory.map((t) => t.tool)).toContain("add_expense");
    expect(typeof output).toBe("string");
  });
});
