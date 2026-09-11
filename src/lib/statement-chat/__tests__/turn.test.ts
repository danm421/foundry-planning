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

import { runTurn, MAX_TOOL_CALLS_PER_TURN, TOOL_DEFS, type TurnModel } from "@/lib/statement-chat/turn";

/** The shape a tool def has once you only care about its parameter schema. */
type ToolDef = {
  function: {
    name: string;
    description: string;
    parameters: { properties: Record<string, { description?: string }>; required: string[] };
  };
};

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

/**
 * Task 8 / R28: `systemPrompt`/`TOOL_DEFS`'s companion `systemPromptForTest`
 * the brief calls for does not exist, and `systemPrompt` stays
 * module-private (the brief's name for it is wrong — nothing exports it).
 * Rather than widen turn.ts's exports for a test, this wraps the one path
 * every other test in this file already uses to read the REAL prompt: run a
 * turn with a model that calls no tool, then read the system message the
 * mocked `bindTools().invoke` actually received. That is deliberate — the
 * scar comment on the schema test below exists because a prior version of
 * this suite asserted on a module-private constant instead of what reached
 * the model, and a tool stayed dead in production with the whole suite
 * green.
 */
async function systemPromptForTest(payload: PersistedImportPayload): Promise<string> {
  const model = modelReturning(new AIMessage("ok"));
  await runTurn({ chat: emptyChat(), importId: "i1", payload, fileResults, message: "hi", model });
  const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
  return String((invoke.mock.calls[0][0] as Array<{ content: unknown }>)[0].content);
}

/**
 * R11: named by the brief but never defined there. Builds `accounts` rows
 * each with `holdingsPerAccount` positions, all living (`__dropped` unset).
 * The first account's first holding is always ticker AAPL with shares=10,
 * matching the literal strings the Step 1 assertions name — every other
 * holding gets a distinct ticker so `JSON.stringify`d labels don't collide.
 * Budget arithmetic this relies on: (2, 3) = 6 lines, comfortably under
 * `HOLDINGS_PROMPT_BUDGET_CHARS` (24,000); (20, 200) = 4,000 lines at ~70
 * chars each, comfortably over it.
 */
function payloadWithHoldings(accounts: number, holdingsPerAccount: number): PersistedImportPayload {
  return {
    accounts: Array.from({ length: accounts }, (_, ai) => ({
      __rowId: `r${ai}`,
      name: `Account ${ai}`,
      value: 100_000,
      holdings: Array.from({ length: holdingsPerAccount }, (_, hi) => {
        const isFirst = ai === 0 && hi === 0;
        const ticker = isFirst ? "AAPL" : `T${ai}_${hi}`;
        return {
          __holdingId: `t:${ticker}#0`,
          ticker,
          shares: isFirst ? 10 : 5,
          price: 100,
          marketValue: 500,
          costBasis: 450,
        };
      }),
    })),
  } as unknown as PersistedImportPayload;
}

/**
 * R33: the same shape as `payloadWithHoldings`, except every position gives
 * ONLY shares + price — no `marketValue` at all, which the extraction prompt
 * explicitly allows ("include price and/or marketValue if shown"). Exists to
 * prove the degraded summary derives a real total via `holdingMarketValue`
 * (shares × price) instead of the `h.marketValue ?? 0` it used to read,
 * which would report 0 for every account shaped like this — the one branch
 * that exists precisely because the positions couldn't be shown in full.
 * Every position is $10 × 100 shares = $1,000, so `holdingsPerAccount`
 * positions total `holdingsPerAccount * 1_000`.
 */
function payloadWithSharesPriceOnlyHoldings(
  accounts: number,
  holdingsPerAccount: number,
): PersistedImportPayload {
  return {
    accounts: Array.from({ length: accounts }, (_, ai) => ({
      __rowId: `r${ai}`,
      name: `Account ${ai}`,
      value: 100_000,
      holdings: Array.from({ length: holdingsPerAccount }, (_, hi) => ({
        __holdingId: `t:T${ai}_${hi}#0`,
        ticker: `T${ai}_${hi}`,
        shares: 10,
        price: 100,
        // Deliberately no marketValue/costBasis — must be DERIVED.
      })),
    })),
  } as unknown as PersistedImportPayload;
}

/**
 * R11: one account with two positions — a living AAPL holding and a
 * `__dropped: true` MSFT holding. `livingHoldings` is the one filter that
 * decides what counts (`@/lib/imports/living-rows`); this fixture exists to
 * prove `describeHoldings` goes through it rather than reading
 * `row.holdings` raw, which would leak the dropped MSFT position into the
 * prompt.
 */
function payloadWithDroppedHolding(): PersistedImportPayload {
  return {
    accounts: [
      {
        __rowId: "r0",
        name: "Account 0",
        value: 10_000,
        holdings: [
          {
            __holdingId: "t:AAPL#0",
            ticker: "AAPL",
            shares: 10,
            price: 100,
            marketValue: 1_000,
            costBasis: 900,
          },
          {
            __holdingId: "t:MSFT#0",
            ticker: "MSFT",
            shares: 5,
            price: 200,
            marketValue: 1_000,
            costBasis: 900,
            __dropped: true,
          },
        ],
      },
    ],
  } as unknown as PersistedImportPayload;
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

  /**
   * Ruling 118. The prompt used to carry a standing "do not try to edit a
   * committed row, say it has to be corrected on the client's accounts
   * instead" directive. Measured in a browser: the real model parroted that
   * sentence at rows that were NOT committed — `committedRowIds` was `[]`,
   * no row carried the `committed=yes` marker, every row still showed a live
   * Commit button — and refused two different edit phrasings outright,
   * calling `edit_row` neither time. That is the entire correction loop dead.
   *
   * Enforcement was always server-side (`assertNotCommitted`), and its error
   * already tells the model what to say. The directive bought a tool call and
   * cost the feature.
   *
   * This asserts only on the removed instruction, not on incidental prose —
   * the rest of the prompt is free to be reworded.
   */
  it("does not instruct the model to refuse committed rows (Ruling 118)", async () => {
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
    expect(systemContent).not.toMatch(/will refuse it/i);
    expect(systemContent).not.toMatch(/Do not try/i);
    expect(systemContent).not.toMatch(/corrected on the client's accounts instead/i);
    // The MARKER stays (Ruling 119) — it is the tool-budget hint, and it was
    // never what fired in the failing session.
    expect(systemContent).toMatch(/- r1:.*committed=yes/);
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

  // --- Final review, T2: the tool SCHEMA is pinned ----------------------
  //
  // Nothing pinned it before. `TOOL_DEFS` was module-private, `bindTools` is
  // stubbed to ignore its argument in every test here, and every reread test
  // calls `rereadDocument()` directly with hand-built args — so renaming this
  // property back to `fileId` left the entire suite green while
  // `reread_document` was dead in production again (the model is never shown
  // a real source file id, so it could only ever send a name). That is
  // exactly the defect the previous fix wave existed to repair, Ruling 103.
  it("declares reread_document's parameter as a required fileName, described as the document's NAME", () => {
    const def = (TOOL_DEFS as unknown as ToolDef[]).find(
      (d) => d.function.name === "reread_document",
    );
    expect(def).toBeDefined();
    const { properties, required } = def!.function.parameters;

    expect(Object.keys(properties)).toContain("fileName");
    expect(Object.keys(properties)).not.toContain("fileId");
    expect(required).toContain("fileName");
    // The description has to tell the model it is a NAME, not an id —
    // otherwise a correctly-named property is still called with an id.
    expect(properties.fileName.description).toMatch(/name of the source document/i);
    expect(properties.fileName.description).toMatch(/as shown for a row/i);
  });

  // The other half: pinning the constant proves nothing if the model is
  // never handed it. `bindTools` is stubbed everywhere else in this file, so
  // this is the one place that looks at what it actually received.
  it("binds those defs to the model, so the schema reaches the real tool call", async () => {
    const bindTools = vi.fn(() => ({ invoke: vi.fn(async () => new AIMessage("ok")) }));
    await runTurn({
      chat: emptyChat(),
      importId: "i1",
      payload: payload(),
      fileResults,
      message: "hi",
      model: { bindTools } as unknown as TurnModel,
    });
    expect(bindTools).toHaveBeenCalledWith(TOOL_DEFS);
    const bound = (bindTools.mock.calls[0] as unknown as [ToolDef[]])[0];
    expect(bound.map((d) => d.function.name)).toEqual([
      "edit_row",
      "merge_rows",
      "drop_row",
      "edit_holding",
      "drop_holding",
      "read_holdings",
      "reread_document",
      "explain",
    ]);
  });

  // Task 7: edit_holding/drop_holding get the model the same two powers the
  // advisor already has on the review table. The schema half (what
  // bindTools is handed) is already pinned by the test above — this pins
  // that TOOL_DEFS carries both names AND that a real edit_holding tool call
  // actually reaches the payload, not just that the def exists.
  it("dispatches edit_holding to the payload", async () => {
    expect(TOOL_DEFS.map((d) => d.function.name)).toEqual(
      expect.arrayContaining(["edit_holding", "drop_holding"]),
    );
    const holdingsPayload = {
      accounts: [
        {
          __rowId: "r1",
          name: "Brokerage",
          holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 }],
        },
      ],
    } as unknown as PersistedImportPayload;
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_holding",
            args: { rowId: "r1", holdingId: "t:AAPL#0", field: "shares", value: 12 },
          },
        ],
      }),
      new AIMessage("Updated the share count."),
    );
    const result = await runTurn({
      chat: emptyChat(),
      importId: "i1",
      payload: holdingsPayload,
      fileResults,
      message: "fix the AAPL share count to 12",
      model,
    });
    expect(result.payload.accounts![0].holdings![0].shares).toBe(12);
  });

  // Task 8: `read_holdings` is read-only — like `explain`/`reread_document`,
  // it must never flip `payloadMutated`. The brief's contract (turn.ts:425)
  // is reference identity: `readHoldings` has to return the SAME payload
  // object it was handed, not an equal-by-value copy, or a turn that only
  // READ positions would falsely tell the route to persist a "mutated"
  // payload. Mutation this catches: `readHoldings` spreading `{ ...payload }`
  // instead of returning `payload` itself.
  it("dispatches read_holdings without mutating the payload", async () => {
    const holdingsPayload = {
      accounts: [
        {
          __rowId: "r1",
          name: "Brokerage",
          holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 }],
        },
      ],
    } as unknown as PersistedImportPayload;
    const model = modelReturning(
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "read_holdings", args: { rowId: "r1" } }],
      }),
      new AIMessage("Here they are."),
    );
    const result = await runTurn({
      chat: emptyChat(),
      importId: "i1",
      payload: holdingsPayload,
      fileResults,
      message: "what's in the brokerage account?",
      model,
    });
    expect(result.payload).toBe(holdingsPayload);
    expect(result.payloadMutated).toBe(false);
    expect(result.turnEntries[1]).toMatchObject({ role: "tool", tool: "read_holdings" });
    expect((result.turnEntries[1] as { summary: string }).summary).toContain("AAPL");
  });

  // M1: an account NAME is model-extracted text from a client's document,
  // exactly like the file name next to it, and the hand-rolled `"${r.name}"`
  // it replaced let a name carrying a literal `"` break out of its own
  // quoting inside the untrusted-data fence.
  //
  // Mutation this catches: reverting `JSON.stringify(r.name)` to
  // `"${r.name}"` — the row line would then read `- r1: "Statement "Final""`,
  // with no unambiguous end to the name.
  it("escapes an account name containing a quote, the same way it escapes a file name", async () => {
    const model = modelReturning(new AIMessage("ok"));
    await runTurn({
      chat: emptyChat(),
      importId: "i1",
      payload: { accounts: [{ __rowId: "r1", name: 'Joint "Rainy Day" Fund', value: 1 }] } as never,
      fileResults,
      message: "hi",
      model,
    });
    const invoke = (model.bindTools([]) as { invoke: ReturnType<typeof vi.fn> }).invoke;
    const systemContent = String(
      (invoke.mock.calls[0][0] as Array<{ content: unknown }>)[0].content,
    );
    expect(systemContent).toContain('"Joint \\"Rainy Day\\" Fund"');
  });
});

describe("describeRows — positions", () => {
  it("inlines every position when they fit the budget", async () => {
    const prompt = await systemPromptForTest(payloadWithHoldings(2, 3));
    expect(prompt).toContain("t:AAPL#0");
    expect(prompt).toContain("shares=10");
  });

  // Fix round 1, Important 5 (R34): this used to also assert
  // `.toContain("read_holdings")` as proof the model is told the tool
  // exists. That mention now lives in `systemPrompt`'s own prose — outside
  // the untrusted-data fence, unconditionally (see the fence test below) —
  // so it is true of EVERY prompt and would pass even if the degraded
  // summary itself said nothing. What actually distinguishes "degraded"
  // from "not" is the per-account summary LINE, so that's what this checks:
  // every position in `payloadWithHoldings` carries `marketValue: 500`, so
  // 200 holdings on account r0 sum to exactly 100,000.
  it("degrades to a per-account summary when they do not fit the budget", async () => {
    const prompt = await systemPromptForTest(payloadWithHoldings(20, 200));
    expect(prompt).not.toContain("t:AAPL#0");
    expect(prompt).toMatch(/r0: 200 holdings totalling 100000/);
  });

  // R33: `payloadWithSharesPriceOnlyHoldings` sets shares + price but NEVER
  // `marketValue` — the shape the extraction prompt explicitly allows.
  // `h.marketValue ?? 0` would report 0 for every such account; the real
  // total (via `holdingMarketValue`, THE definition of a position's value)
  // is shares × price = 10 × 100 = 1,000 per position, so 200 positions on
  // account r0 total exactly 200,000 — never 0.
  it("derives the degraded summary's total from shares×price when marketValue is absent (R33)", async () => {
    const prompt = await systemPromptForTest(payloadWithSharesPriceOnlyHoldings(20, 200));
    expect(prompt).toMatch(/r0: 200 holdings totalling 200000/);
    expect(prompt).not.toMatch(/totalling 0\b/);
  });

  it("never inlines a dropped position, but does inline the living one alongside it", async () => {
    const prompt = await systemPromptForTest(payloadWithDroppedHolding());
    expect(prompt).not.toContain("t:MSFT#0");
    // Positive companion: without this, the assertion above would pass just
    // as well if `describeHoldings` returned "" for every payload.
    expect(prompt).toContain("t:AAPL#0");
  });

  // Fix round 1, Important 5 (R34): `.toContain("<<<UNTRUSTED DATA")` could
  // never fail — it was already satisfied by the pre-existing row list, so
  // it passed whether the holdings block landed inside the fence, outside
  // it, or inside a SECOND fence of its own. This is a prompt-injection
  // boundary (Important 3), so the real claim — "one fence, and the
  // holdings block is inside it" — has to be checked positionally: the
  // HOLDINGS: block's index must fall strictly between the real open and
  // close fence markers, and the real open marker (the FULL string, with
  // its "— extracted from client documents" suffix — the short form
  // "<<<UNTRUSTED DATA>>>" also appears once in the prose explaining the
  // fence to the model, so counting THAT substring can never prove
  // uniqueness) must occur exactly once in the system prompt.
  it("fences the positions block inside the SAME single fence as the row list, never a second one", async () => {
    const prompt = await systemPromptForTest(payloadWithHoldings(1, 2));
    const OPEN = "<<<UNTRUSTED DATA — extracted from client documents>>>";
    const CLOSE = "<<<END UNTRUSTED DATA>>>";
    const openIdx = prompt.indexOf(OPEN);
    const holdingsIdx = prompt.indexOf("HOLDINGS:");
    const closeIdx = prompt.indexOf(CLOSE, openIdx + OPEN.length);

    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
    expect(holdingsIdx).toBeGreaterThan(openIdx);
    expect(holdingsIdx).toBeLessThan(closeIdx);
    // Exactly one real open fence — a second HOLDINGS-only fence would add a
    // second occurrence of this exact string.
    expect(prompt.indexOf(OPEN, openIdx + 1)).toBe(-1);
  });

  // R29: `__holdingId` is optional on `ExtractedHolding` — a payload
  // persisted before this branch carries positions with none. Printing
  // `${h.__holdingId}:` unconditionally renders the literal string
  // "undefined" as an id, and a model reading that as a real handle would
  // call edit_holding/drop_holding with it — both throw, since neither tool
  // has a holding whose id IS "undefined", burning one of the four tool
  // calls this turn allows on a position that was never correctable through
  // this surface to begin with (both tools match on __holdingId).
  it('never prints "undefined" as a holding id, and marks that position not correctable', async () => {
    const payloadMissingId: PersistedImportPayload = {
      accounts: [
        {
          __rowId: "r0",
          name: "Legacy Account",
          value: 5_000,
          holdings: [{ ticker: "OLD", shares: 3 }],
        },
      ],
    } as unknown as PersistedImportPayload;
    const prompt = await systemPromptForTest(payloadMissingId);
    expect(prompt).not.toMatch(/undefined/);
    expect(prompt).toMatch(/not correctable/i);
  });
});
