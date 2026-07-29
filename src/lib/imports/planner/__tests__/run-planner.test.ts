import { describe, expect, it, vi } from "vitest";
import { emptyImportPayload } from "../../types";
import { runPlanner } from "../run-planner";

const MINIMAL = { version: 1, assumptions: {}, savings: [], socialSecurity: [], goals: [], incomeTiming: [], questions: [], notes: [] };

/** A model double that emits a scripted sequence of tool calls. */
function scriptedModel(turns: Array<{ tool_calls?: Array<{ name: string; args: unknown; id: string }>; content?: string }>) {
  let i = 0;
  const model = {
    bindTools: () => model,
    invoke: async () => {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      return { content: turn.content ?? "", tool_calls: turn.tool_calls ?? [] };
    },
  };
  return model as never;
}

const BASE = {
  documentText: "Retirement age 64.",
  pages: ["Retirement age 64."],
  payload: emptyImportPayload(),
  estimatePia: () => 3000,
};

describe("runPlanner", () => {
  it("returns the proposal once propose_decisions succeeds", async () => {
    const model = scriptedModel([
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c1" }] },
    ]);
    await expect(runPlanner({ ...BASE, model })).resolves.toMatchObject({ version: 1 });
  });

  it("lets the model read before proposing", async () => {
    const model = scriptedModel([
      { tool_calls: [{ name: "read_document", args: {}, id: "c1" }] },
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c2" }] },
    ]);
    await expect(runPlanner({ ...BASE, model })).resolves.toMatchObject({ version: 1 });
  });

  it("returns null when the model never proposes within maxIterations", async () => {
    const model = scriptedModel([{ tool_calls: [{ name: "read_document", args: {}, id: "c1" }] }]);
    await expect(runPlanner({ ...BASE, model, maxIterations: 3 })).resolves.toBeNull();
  });

  it("invokes the model exactly maxIterations times when it never proposes", async () => {
    let calls = 0;
    const model = {
      bindTools: () => model,
      invoke: async () => {
        calls += 1;
        return { content: "", tool_calls: [{ name: "read_document", args: {}, id: `c${calls}` }] };
      },
    } as never;
    await runPlanner({ ...BASE, model, maxIterations: 3 });
    expect(calls).toBe(3);
  });

  it("returns null rather than throwing when the model errors", async () => {
    const model = { bindTools: () => model, invoke: async () => { throw new Error("azure 500"); } } as never;
    await expect(runPlanner({ ...BASE, model })).resolves.toBeNull();
  });

  it("returns null when it exceeds its timeout", async () => {
    const model = {
      bindTools: () => model,
      invoke: () => new Promise((r) => setTimeout(r, 200)),
    } as never;
    await expect(runPlanner({ ...BASE, model, timeoutMs: 20 })).resolves.toBeNull();
  });

  it("keeps going after an invalid proposal", async () => {
    const model = scriptedModel([
      { tool_calls: [{ name: "propose_decisions", args: { decisions: { version: 99 } }, id: "c1" }] },
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c2" }] },
    ]);
    await expect(runPlanner({ ...BASE, model })).resolves.toMatchObject({ version: 1 });
  });
});
