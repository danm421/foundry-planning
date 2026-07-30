import { describe, expect, it, vi } from "vitest";
import { emptyImportPayload } from "../../types";
import { runPlanner } from "../run-planner";
import { buildPlannerTools } from "../tools";

// Every test below passes an explicit `model`, so `chatModel` is never
// reached except by the "unconfigured environment" test. Mocking it here
// (rather than relying on the ambient .env.local, which may or may not have
// Azure vars set in this worktree) is the honest, deterministic seam for
// that one scenario.
vi.mock("@/domain/forge/llm", () => ({
  chatModel: () => {
    throw new Error("ai_not_configured");
  },
}));

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
      invoke: () => new Promise(() => {}),
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

  it("returns null when the environment is unconfigured", async () => {
    await expect(runPlanner({ ...BASE })).resolves.toBeNull();
  });
});

// R7 (whole-branch review, I6). `await tool.invoke(call.args as never)` sat bare
// inside the per-call loop. LangChain throws on a schema violation, it
// propagated to `runPlanner`'s outer catch, `runPlanner` returned null, and
// every prior iteration's work was discarded — one bad argument cost the whole
// run. `read_document`'s schema types `startPage` as an int, so a string is a
// real LangChain-level parse failure rather than a hand-thrown stub.
describe("runPlanner — a malformed tool-call argument", () => {
  const BAD_READ = { name: "read_document", args: { startPage: "page two" }, id: "c1" };

  /** A model double that records every message list it is handed. */
  function recordingModel(turns: Array<{ tool_calls?: Array<{ name: string; args: unknown; id: string }> }>) {
    const seen: Array<Array<{ content?: unknown; tool_call_id?: string }>> = [];
    let i = 0;
    const model = {
      bindTools: () => model,
      invoke: async (messages: Array<{ content?: unknown; tool_call_id?: string }>) => {
        seen.push([...messages]);
        const turn = turns[Math.min(i, turns.length - 1)];
        i += 1;
        return { content: "", tool_calls: turn.tool_calls ?? [] };
      },
    };
    return { model: model as never, seen };
  }

  it("really is a tool-level failure, not a no-op (assert the instrument)", async () => {
    // If `read_document` happened to ACCEPT `startPage: "page two"`, every
    // assertion below would pass for the wrong reason.
    const { tools } = buildPlannerTools({
      documentText: "Retirement age 64.",
      pages: ["Retirement age 64."],
      payload: emptyImportPayload(),
      estimatePia: () => 3000,
    });
    const readDocument = tools.find((t) => t.name === "read_document");
    expect(readDocument).toBeDefined();
    await expect(readDocument!.invoke(BAD_READ.args as never)).rejects.toBeTruthy();
  });

  it("does not abort the run — the model still proposes on the next iteration", async () => {
    const model = scriptedModel([
      { tool_calls: [BAD_READ] },
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c2" }] },
    ]);
    await expect(runPlanner({ ...BASE, model })).resolves.toMatchObject({ version: 1 });
  });

  it("feeds the error text back as that call's ToolMessage so the model can correct it", async () => {
    const { model, seen } = recordingModel([
      { tool_calls: [BAD_READ] },
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c2" }] },
    ]);
    await runPlanner({ ...BASE, model });

    // The SECOND turn's transcript is what the model saw after the failure.
    const secondTurn = seen[1];
    const toolMessage = secondTurn.find((m) => m.tool_call_id === "c1");
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage?.content)).toContain('Tool "read_document" failed');
    expect(String(toolMessage?.content)).toContain("call it again");
  });

  it("keeps the transcript well-formed: every tool_call id has a matching ToolMessage", async () => {
    // An AIMessage carrying tool_calls with no matching ToolMessage is itself a
    // provider error, so the failure path must still push a message.
    const { model, seen } = recordingModel([
      { tool_calls: [BAD_READ, { name: "read_document", args: { startPage: 1 }, id: "c1b" }] },
      { tool_calls: [{ name: "propose_decisions", args: { decisions: MINIMAL }, id: "c2" }] },
    ]);
    await runPlanner({ ...BASE, model });

    const ids = seen[1].map((m) => m.tool_call_id).filter(Boolean);
    expect(ids).toEqual(["c1", "c1b"]);
  });

  it("still returns a proposal recorded BEFORE the failing call in the same turn", async () => {
    // The whole point of R7: work already done is not thrown away.
    const model = scriptedModel([
      {
        tool_calls: [
          { name: "propose_decisions", args: { decisions: MINIMAL }, id: "c1" },
          BAD_READ,
        ],
      },
    ]);
    await expect(runPlanner({ ...BASE, model })).resolves.toMatchObject({ version: 1 });
  });
});
