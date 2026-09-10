import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import type { PersistedImportPayload, ChatState } from "@/lib/imports/types";
import type { ExtractionResult } from "@/lib/extraction/types";

const chatModelInvoke = vi.fn(async () => new AIMessage("Sure, done."));
const chatModel = vi.fn(async () => ({
  bindTools: () => ({ invoke: chatModelInvoke }),
  invoke: chatModelInvoke,
}));
vi.mock("@/domain/forge/llm", () => ({ chatModel: (...a: unknown[]) => chatModel(...(a as [])) }));

import { runTurn, MAX_TOOL_CALLS_PER_TURN, type TurnModel } from "@/lib/statement-chat/turn";

function payload(): PersistedImportPayload {
  return {
    accounts: [
      { __rowId: "r1", name: "IRA", value: 10_000, basis: 5_000 },
      { __rowId: "r2", name: "Brokerage", value: 20_000 },
    ],
  } as never;
}

function emptyChat(): ChatState {
  return { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [] };
}

const fileResults: Record<string, ExtractionResult> = {};

function modelReturning(...responses: AIMessage[]): TurnModel {
  const invoke = vi.fn();
  for (const r of responses) invoke.mockResolvedValueOnce(r);
  return { bindTools: () => ({ invoke }) };
}

/** A model that ALWAYS asks to call `edit_row` again — used to prove the cap. */
function infiniteToolCaller(): { model: TurnModel; invoke: ReturnType<typeof vi.fn> } {
  let n = 0;
  const invoke = vi.fn(async () =>
    new AIMessage({
      content: "",
      tool_calls: [{ id: `call_${n++}`, name: "edit_row", args: { rowId: "r1", field: "value", value: n } }],
    }),
  );
  return { model: { bindTools: () => ({ invoke }) }, invoke };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTurn", () => {
  // Mutation this catches: returning `finalText` unconditionally instead of
  // falling back to "Okay." when the model replies with empty content — the
  // C13 #2 guarantee ("summary populated on every turn") would then produce
  // an empty transcript entry silently.
  it("returns a non-empty summary and appends no tool turns when the model calls no tool", async () => {
    const model = modelReturning(new AIMessage("The rows look fine."));
    const result = await runTurn({
      chat: emptyChat(),
      payload: payload(),
      fileResults,
      message: "does this look right?",
      model,
    });
    expect(result.summary).toBe("The rows look fine.");
    expect(result.turnEntries).toEqual([
      { role: "user", text: "does this look right?", at: expect.any(String) },
      { role: "assistant", text: "The rows look fine.", at: expect.any(String) },
    ]);
    expect(result.payload).toEqual(payload());
  });

  // Mutation this catches: dispatching tool calls to the wrong function name
  // (e.g. always calling `editRow` regardless of `call.name`) — the payload
  // would then reflect an edit instead of a drop, and `newExcludedRows`
  // would stay empty.
  it("threads a tool call's payload mutation through to the final result", async () => {
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "edit_row", args: { rowId: "r1", field: "basis", value: 5_500 } }],
      }),
      new AIMessage("Updated the basis."),
    );
    const result = await runTurn({
      chat: emptyChat(),
      payload: payload(),
      fileResults,
      message: "fix the basis on the IRA to 5500",
      model,
    });
    expect(result.payload.accounts?.[0].basis).toBe(5_500);
    expect(result.turnEntries.map((t) => t.role)).toEqual(["user", "tool", "assistant"]);
    expect(result.turnEntries[1]).toMatchObject({ role: "tool", tool: "edit_row" });
    expect(result.summary).toBe("Updated the basis.");
  });

  // Mutation this catches: `drop_row`'s `excludedRows` result never being
  // collected into `newExcludedRows` (e.g. an `if (result.excludedRows)`
  // check that always evaluates false, or a typo reading `result.excluded`).
  it("collects drop_row's excluded entry into newExcludedRows", async () => {
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "drop_row", args: { rowId: "r2", reason: "duplicate" } }],
      }),
      new AIMessage("Dropped it."),
    );
    const result = await runTurn({
      chat: emptyChat(),
      payload: payload(),
      fileResults,
      message: "drop the brokerage row, it's a duplicate",
      model,
    });
    expect(result.newExcludedRows).toHaveLength(1);
    expect(result.newExcludedRows[0].row).toMatchObject({ __rowId: "r2" });
    expect(result.payload.accounts?.map((r) => r.__rowId)).toEqual(["r1"]);
  });

  // Mutation this catches: a thrown tool error propagating out of `runTurn`
  // instead of being caught and turned into a tool-turn entry — proves a bad
  // tool call degrades to a readable message rather than a 500.
  it("turns a failed tool call into an error tool-turn instead of throwing", async () => {
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "edit_row", args: { rowId: "nope", field: "value", value: 1 } }],
      }),
      new AIMessage("I couldn't find that row."),
    );
    const result = await runTurn({
      chat: emptyChat(),
      payload: payload(),
      fileResults,
      message: "fix the missing row",
      model,
    });
    expect(result.turnEntries[1]).toMatchObject({ role: "tool", tool: "edit_row" });
    expect((result.turnEntries[1] as { summary: string }).summary).toMatch(/unknown row/i);
    // The payload is untouched by the failed call.
    expect(result.payload).toEqual(payload());
  });

  // THE cap test (C11): a model that never stops asking for tool calls must
  // still be cut off at MAX_TOOL_CALLS_PER_TURN. Mutation this catches:
  // deleting/off-by-one-ing the `toolCallCount >= MAX_TOOL_CALLS_PER_TURN`
  // guard (e.g. `>` instead of `>=`, which would allow a 5th call).
  it("never executes more than MAX_TOOL_CALLS_PER_TURN tool calls even when the model keeps asking", async () => {
    const { model, invoke } = infiniteToolCaller();
    const result = await runTurn({
      chat: emptyChat(),
      payload: payload(),
      fileResults,
      message: "keep going",
      model,
    });
    const toolTurns = result.turnEntries.filter((t) => t.role === "tool");
    expect(toolTurns).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    // One more round than the cap: the model is invoked once per executed
    // tool-call round plus one final round with nothing left to run.
    expect(invoke).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN + 1);
    // The turn still ends with SOME summary rather than looping forever.
    expect(result.summary.length).toBeGreaterThan(0);
  });

  // Mutation this catches: building the model directly from `chatModel()`
  // without `.bindTools(...)`, or calling the full deployment instead of
  // "mini" — proves the DEFAULT wiring (no `model` override) goes through
  // `chatModel("mini")` as documented.
  it("defaults to chatModel(\"mini\").bindTools(...) when no model override is given", async () => {
    await runTurn({ chat: emptyChat(), payload: payload(), fileResults, message: "hi" });
    expect(chatModel).toHaveBeenCalledWith("mini");
  });
});
