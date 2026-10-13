import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inUsageScope, newUsageReport } from "@/lib/ai/usage";
import { lineIdOf } from "../../change-set";
import type { LeftoverItem, TargetDraft } from "../types";

// The model is the only IO here; mocked as the insights tests do, so the suite
// runs without Azure credentials and can see the tier, the schema and the call.
const invoke = vi.hoisted(() => vi.fn());
const withStructuredOutput = vi.hoisted(() =>
  vi.fn<(schema: unknown, opts?: unknown) => { invoke: typeof invoke }>(() => ({ invoke })),
);
const chatModel = vi.hoisted(() =>
  vi.fn<(tier: string) => Promise<{ withStructuredOutput: typeof withStructuredOutput }>>(async () => ({
    withStructuredOutput,
  })),
);
vi.mock("@/domain/forge/llm", () => ({ chatModel }));

import { buildLeftoversPrompt, LeftoversOutputSchema, type LeftoversOutput } from "../leftovers";
import { runLeftovers } from "../leftovers-run";

const item: LeftoverItem = {
  id: "fn:notes",
  cell: { sectionId: "final_notes", rowId: "fn", columnId: "notes" },
  text: "The old 401(k) was worth $412,330 at last year end.",
  kind: "note",
  topic: "general",
  columnLabel: "Notes",
  rowLabel: "Anything else we should know?",
};
const draft: TargetDraft = {
  lineId: lineIdOf("r1", "account"),
  sectionId: "retirement",
  rowId: "r1",
  target: "account",
  recordId: null,
  label: "Fidelity IRA",
  fields: [],
  warnings: [],
};
const OUTPUT: LeftoversOutput = {
  items: [
    { itemId: "fn:notes", action: "note", lineId: null, key: null, value: null, quote: null, topic: "investments", reason: null },
  ],
};
/** What `withStructuredOutput(…, { includeRaw: true })` resolves to: the model's message and the parsed reply. */
const reply = (parsed: LeftoversOutput | null) => ({
  raw: new AIMessage({
    content: "",
    response_metadata: { model_name: "gpt-5.4" },
    usage_metadata: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500, input_token_details: { cache_read: 200 } },
  }),
  parsed,
});
const SPENT = { calls: 1, promptTokens: 1200, cachedPromptTokens: 200, completionTokens: 300 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runLeftovers", () => {
  it("makes no call when there is nothing to place", async () => {
    expect(await runLeftovers([], [draft])).toBeNull();
    expect(chatModel).not.toHaveBeenCalled();
  });

  it("asks the full model once, for the leftovers schema with its raw reply, with the prompt and a time limit", async () => {
    invoke.mockResolvedValueOnce(reply(OUTPUT));
    expect(await runLeftovers([item], [draft])).toEqual(OUTPUT);
    expect(chatModel).toHaveBeenCalledExactlyOnceWith("full");
    expect(withStructuredOutput).toHaveBeenCalledExactlyOnceWith(LeftoversOutputSchema, {
      name: "fact_finder_leftovers",
      includeRaw: true,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    const [messages, options] = invoke.mock.calls[0] as [unknown[], { signal?: unknown }];
    const { system, user } = buildLeftoversPrompt([item], [draft]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect((messages[0] as SystemMessage).content).toBe(system);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect((messages[1] as HumanMessage).content).toBe(user);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("bills the call to the review's usage scope, under its own stage and the model it ran on", async () => {
    invoke.mockResolvedValueOnce(reply(OUTPUT));
    const report = newUsageReport();
    await inUsageScope(report, () => runLeftovers([item], [draft]));
    expect(report).toEqual({ total: SPENT, byStage: { "fact-finder-leftovers": SPENT }, byModel: { "gpt-5.4": SPENT } });
  });

  it("returns null when the reply doesn't fit the schema — and still bills the tokens it spent", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockResolvedValueOnce(reply(null));
    const report = newUsageReport();
    expect(await inUsageScope(report, () => runLeftovers([item], [draft]))).toBeNull();
    expect(report.total).toEqual(SPENT);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("returns null when the call fails — a timeout or a network error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("Request was aborted."));
    expect(await runLeftovers([item], [draft])).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("returns null when the firm has no AI set up", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    chatModel.mockRejectedValueOnce(new Error("ai_not_configured"));
    expect(await runLeftovers([item], [draft])).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
