import { describe, it, expect, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";

// Mirror the graph.test.ts mock so no live Clerk/DB/Azure is touched. The model
// must return AIMessage instances (the messages reducer coerces them); a plain
// object fails MESSAGE_COERCION.
vi.mock("@/domain/forge/llm", () => ({
  chatModel: () => ({
    bindTools: () => ({
      // Deterministic fake: emit TWO add_expense tool calls in one turn (a batch),
      // then a final answer. Two, so the trajectory is proven to keep every call
      // of a repeated tool — a batch collapsing to one entry is exactly the blind
      // spot the batch eval case exists to catch.
      invoke: vi
        .fn()
        .mockResolvedValueOnce(
          new AIMessage({
            content: "",
            tool_calls: [
              { id: "t1", name: "add_expense", args: { label: "Gym", annualAmount: 1200 } },
              { id: "t2", name: "add_expense", args: { label: "Yoga", annualAmount: 600 } },
            ],
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
    // One entry PER CALL, not per tool name.
    expect(trajectory.filter((t) => t.tool === "add_expense")).toHaveLength(2);
    expect(typeof output).toBe("string");
  });
});

describe("default export", () => {
  it("is a class promptfoo can `new`, and delegates to the graph", async () => {
    // promptfoo instantiates a file:// provider with `new`; a plain object dies
    // at load time ("(intermediate value) is not a constructor") before any case runs.
    const mod = await import("../provider");
    const provider = new mod.default();
    expect(provider.id()).toBe("forge-graph");
    const res = await provider.callApi("Add a $1,200/yr gym expense", { vars: {} });
    expect(res.metadata.trajectory.map((t) => t.tool)).toContain("add_expense");
  });
});
