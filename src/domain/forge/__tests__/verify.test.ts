import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

// Mock the mini critic model: chatModel("mini").withStructuredOutput(schema).invoke()
const criticInvoke = vi.hoisted(() => vi.fn());
const withStructuredOutput = vi.hoisted(() => vi.fn(() => ({ invoke: criticInvoke })));
vi.mock("../llm", () => ({ chatModel: () => ({ withStructuredOutput }) }));

// Custom-event dispatch is a no-op we just want to not throw / to spy on.
const dispatchCustomEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@langchain/core/callbacks/dispatch", () => ({ dispatchCustomEvent }));

import {
  runCritic,
  evaluateAnswer,
  windowToolResults,
  verifyNode,
  VERIFY_CAVEAT,
} from "../verify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runCritic", () => {
  it("returns the model verdict on success", async () => {
    criticInvoke.mockResolvedValue({ ok: false, problems: ["bad math"] });
    const v = await runCritic({ question: "q", toolResults: "r", answer: "a" });
    expect(v).toEqual({ ok: false, problems: ["bad math"] });
  });
  it("fails OPEN when the model throws", async () => {
    criticInvoke.mockRejectedValue(new Error("azure 500"));
    const v = await runCritic({ question: "q", toolResults: "r", answer: "a" });
    expect(v).toEqual({ ok: true, problems: [] });
  });
});

describe("evaluateAnswer", () => {
  it("fails at Tier 1 when a figure does not trace to tool results (critic not called)", async () => {
    const v = await evaluateAnswer({
      question: "ending balance?",
      answer: "Ending balance is $2.5M.",
      toolResults: ["endingBalance: 1000000"],
    });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toMatch(/don't trace/i);
    expect(criticInvoke).not.toHaveBeenCalled();
  });
  it("passes Tier 1 then defers to the critic", async () => {
    criticInvoke.mockResolvedValue({ ok: true, problems: [] });
    const v = await evaluateAnswer({
      question: "ending balance?",
      answer: "Ending balance is $1,000,000.",
      toolResults: ["endingBalance: 1000000"],
    });
    expect(v.ok).toBe(true);
    expect(criticInvoke).toHaveBeenCalledOnce();
  });
});

describe("windowToolResults", () => {
  it("returns only ToolMessage contents", () => {
    const out = windowToolResults([
      new HumanMessage("q"),
      new ToolMessage({ tool_call_id: "t1", content: "endingBalance: 1000000" }),
      new AIMessage("answer"),
    ]);
    expect(out).toEqual(["endingBalance: 1000000"]);
  });
});

describe("verifyNode", () => {
  const base = {
    authContext: { userId: "u", firmId: "f", clientId: "c", scenarioId: "base" },
    verifyDecision: null,
  };

  it("passes a grounded, critic-approved answer", async () => {
    criticInvoke.mockResolvedValue({ ok: true, problems: [] });
    const state = {
      ...base,
      verifyAttempts: 0,
      messages: [
        new HumanMessage("ending balance?"),
        new ToolMessage({ tool_call_id: "t1", content: "endingBalance: 1000000" }),
        new AIMessage("Ending balance is $1,000,000."),
      ],
    };
    const out = await verifyNode(state as never);
    expect(out.verifyDecision).toBe("pass");
    expect(dispatchCustomEvent).toHaveBeenCalledWith(
      "forge_verify",
      { result: "start" },
      undefined,
    );
  });

  it("retries (with a critique + incremented counter) on the first failure", async () => {
    const state = {
      ...base,
      verifyAttempts: 0,
      messages: [new HumanMessage("balance?"), new AIMessage("It's $2.5M.")], // ungrounded
    };
    const out = await verifyNode(state as never);
    expect(out.verifyDecision).toBe("retry");
    expect(out.verifyAttempts).toBe(1);
    expect(out.messages?.[0]).toBeInstanceOf(HumanMessage);
    expect(String(out.messages?.[0].content)).toMatch(/reviewer flagged/i);
  });

  it("releases with a caveat once the retry budget is spent", async () => {
    const state = {
      ...base,
      verifyAttempts: 1,
      messages: [new HumanMessage("balance?"), new AIMessage("It's $2.5M.")], // ungrounded
    };
    const out = await verifyNode(state as never);
    expect(out.verifyDecision).toBe("caveat");
    expect(dispatchCustomEvent).toHaveBeenCalledWith(
      "forge_verify",
      { result: "caveat", caveat: VERIFY_CAVEAT },
      undefined,
    );
  });
});
