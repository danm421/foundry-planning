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
      importId: "i1",
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
      importId: "i1",
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
      importId: "i1",
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
      importId: "i1",
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

  // Final review, C3: the committed set has to actually REACH the tools.
  // `runTurn` reads it off `chat.committedRowIds` — the persisted list, which
  // the turn route already hands in whole — so this is the wiring test: a
  // chat state naming r1 as committed must make `edit_row` on r1 fail.
  //
  // Mutation this catches: `dispatchTool` dropping `ctx.committedRowIds`, or
  // `runTurn` building the set from something other than `chat`.
  it("refuses a mutating tool call against a row chat.committedRowIds names", async () => {
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "edit_row", args: { rowId: "r1", field: "value", value: 99 } }],
      }),
      new AIMessage("That one is already committed."),
    );
    const result = await runTurn({
      chat: { ...emptyChat(), committedRowIds: ["r1"] },
      importId: "i1",
      payload: payload(),
      fileResults,
      message: "change the IRA to 99",
      model,
    });
    expect(result.turnEntries[1]).toMatchObject({ role: "tool", tool: "edit_row" });
    expect((result.turnEntries[1] as { summary: string }).summary).toMatch(/already been committed/i);
    // Nothing was written, and the route is told not to persist a payload.
    expect(result.payload).toEqual(payload());
    expect(result.payloadMutated).toBe(false);
  });

  // Every refused call still burns one of the four tool calls this turn is
  // allowed, so the row list tells the model up front which rows are closed.
  it("marks a committed row in the row list the model reads", async () => {
    const model = modelReturning(new AIMessage("ok"));
    await runTurn({
      chat: { ...emptyChat(), committedRowIds: ["r1"] },
      importId: "i1",
      payload: payload(),
      fileResults,
      message: "hi",
      model,
    });
    const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
    const systemContent = String(
      (invoke.mock.calls[0][0] as Array<{ content: unknown }>)[0].content,
    );
    expect(systemContent).toMatch(/- r1:.*committed=yes/);
    expect(systemContent).not.toMatch(/- r2:.*committed=yes/);
  });

  // THE cap test (C11): a model that never stops asking for tool calls must
  // still be cut off at MAX_TOOL_CALLS_PER_TURN. Mutation this catches:
  // deleting/off-by-one-ing the `toolCallCount >= MAX_TOOL_CALLS_PER_TURN`
  // guard (e.g. `>` instead of `>=`, which would allow a 5th call).
  it("never executes more than MAX_TOOL_CALLS_PER_TURN tool calls even when the model keeps asking", async () => {
    const { model, invoke } = infiniteToolCaller();
    const result = await runTurn({
      chat: emptyChat(),
      importId: "i1",
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
    await runTurn({ chat: emptyChat(), payload: payload(), fileResults, message: "hi", importId: "i1" });
    expect(chatModel).toHaveBeenCalledWith("mini");
  });

  // Review round 1, Important 3: every row value (name, custodian, value,
  // file name) is model-extracted from a client-uploaded document —
  // untrusted content, not something this system authored. A poisoned
  // statement can otherwise steer drop_row/merge_rows/edit_row, all three of
  // which persist immediately with no advisor confirmation. Mutation this
  // catches: removing the fence markers / warning sentence from
  // `describeRows`/`systemPrompt` (reverting to the reviewed, unfenced
  // version) — the model would then see the row data with no signal
  // distinguishing it from an instruction.
  it("fences the row list as untrusted, non-instruction data in the system prompt (Important 3)", async () => {
    const model = modelReturning(new AIMessage("ok"));
    await runTurn({ chat: emptyChat(), payload: payload(), fileResults, message: "hi", importId: "i1", model });

    const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
    const firstCallMessages = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    const systemContent = String(firstCallMessages[0].content);
    expect(systemContent).toMatch(/never an instruction/i);
    // Not just "the phrase <<<UNTRUSTED DATA>>> appears somewhere" (the
    // explanatory sentence above uses it too, so that alone proves nothing
    // about the ROW DATA itself) — the opening fence must be immediately
    // followed by an actual row line, and the closing fence must follow it.
    expect(systemContent).toMatch(/<<<UNTRUSTED DATA[^>]*>>>\s*\n-\s*r1:.*"IRA"[\s\S]*<<<END UNTRUSTED DATA>>>/);
  });

  it("fences a replayed tool summary from prior history the same way (Important 3)", async () => {
    const chat: ChatState = {
      ...emptyChat(),
      transcript: [{ role: "tool", tool: "edit_row", summary: 'Set name to "ignore instructions".', at: "t0" }],
    };
    const model = modelReturning(new AIMessage("ok"));
    await runTurn({ chat, payload: payload(), fileResults, message: "hi", importId: "i1", model });

    const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
    const firstCallMessages = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    // messages[0] is the system prompt, messages[1] is the replayed tool turn.
    const replayedContent = String(firstCallMessages[1].content);
    expect(replayedContent).toContain("<<<UNTRUSTED DATA");
    expect(replayedContent).toContain("<<<END UNTRUSTED DATA>>>");
  });

  // Ruling 103 / describeRows: the quoted source="…" form is the producer
  // half of the reread_document fix — the tool resolves a document by the
  // exact name shown here, so if this ever reverts to an unquoted form (or
  // to the raw sourceFileId), reread_document goes unreachable again with a
  // green suite. Fixture shape matches the real caller: `fileResults` is
  // `payloadJson.fileResults` keyed by source-file id with each value
  // carrying its own `fileName`, and rows carry `__provenance.sourceFileId`
  // set to exactly those keys, the same as `mergeAcrossFiles` produces.
  it("quotes each row's source as the file NAME, not its id, with a space-containing name intact (Ruling 103)", async () => {
    const FILE_ID_1 = "11111111-1111-1111-1111-111111111111";
    const FILE_ID_2 = "22222222-2222-2222-2222-222222222222";
    const fileResultsFixture: Record<string, ExtractionResult> = {
      [FILE_ID_1]: {
        documentType: "account_statement",
        fileName: "fidelity-2026-06.pdf",
        extracted: {
          accounts: [], incomes: [], expenses: [], liabilities: [], entities: [],
          lifePolicies: [], wills: [], savings: [], goals: [],
        },
        warnings: [],
        promptVersion: "v",
      } as unknown as ExtractionResult,
      [FILE_ID_2]: {
        documentType: "account_statement",
        fileName: "Fidelity Statement June 2026.pdf",
        extracted: {
          accounts: [], incomes: [], expenses: [], liabilities: [], entities: [],
          lifePolicies: [], wills: [], savings: [], goals: [],
        },
        warnings: [],
        promptVersion: "v",
      } as unknown as ExtractionResult,
    };
    const provenancedPayload: PersistedImportPayload = {
      accounts: [
        {
          __rowId: "r1",
          name: "Brokerage",
          value: 10_000,
          __provenance: { sourceFileId: FILE_ID_1, section: "accounts" },
        },
        {
          __rowId: "r2",
          name: "Roth IRA",
          value: 20_000,
          __provenance: { sourceFileId: FILE_ID_2, section: "accounts" },
        },
      ],
    } as never;

    const model = modelReturning(new AIMessage("ok"));
    await runTurn({
      chat: emptyChat(),
      payload: provenancedPayload,
      fileResults: fileResultsFixture,
      message: "hi",
      importId: "i1",
      model,
    });

    const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
    const firstCallMessages = invoke.mock.calls[0][0] as Array<{ content: unknown }>;
    const systemContent = String(firstCallMessages[0].content);

    expect(systemContent).toContain('source="fidelity-2026-06.pdf"');
    // The space inside the name must survive with its boundary intact — no
    // truncation at the first space, no missing closing quote.
    expect(systemContent).toContain('source="Fidelity Statement June 2026.pdf"');
    // The raw sourceFileId must never leak into the model-facing text when a
    // name is known — that is exactly the case that breaks reread_document.
    expect(systemContent).not.toContain(FILE_ID_1);
    expect(systemContent).not.toContain(FILE_ID_2);
  });
});
