// src/domain/forge/__tests__/history-window.test.ts
import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { selectHistoryWindow, compactHistory } from "../history-window";

// A realistic agentic turn: human asks → AI calls a tool → tool result → AI answers.
function turn(n: number) {
  return [
    new HumanMessage(`q${n}`),
    new AIMessage({ content: "", tool_calls: [{ id: `c${n}`, name: "read_detail", args: {} }] }),
    new ToolMessage({ tool_call_id: `c${n}`, content: `result ${n}` }),
    new AIMessage(`a${n}`),
  ];
}

describe("selectHistoryWindow", () => {
  it("returns everything when under the limit", () => {
    const msgs = [...turn(1), ...turn(2)];
    expect(selectHistoryWindow(msgs, 40)).toBe(msgs);
  });

  it("keeps the most recent messages when over the limit", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => turn(i + 1)).flat(); // 40 msgs
    const out = selectHistoryWindow(msgs, 6);
    expect(out.length).toBeLessThanOrEqual(msgs.length);
    expect(out[out.length - 1]).toBe(msgs[msgs.length - 1]);
  });

  it("always begins the window on a HumanMessage so tool exchanges are never orphaned", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => turn(i + 1)).flat();
    const out = selectHistoryWindow(msgs, 6);
    expect(out[0]).toBeInstanceOf(HumanMessage);
  });

  it("never returns a leading orphaned ToolMessage", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => turn(i + 1)).flat();
    for (const max of [1, 2, 3, 5, 7]) {
      const out = selectHistoryWindow(msgs, max);
      expect(out[0]).not.toBeInstanceOf(ToolMessage);
    }
  });
});

describe("compactHistory", () => {
  it("returns the messages unchanged when under the window", () => {
    const msgs = [...turn(1), ...turn(2)];
    expect(compactHistory(msgs, { windowSize: 40 })).toBe(msgs);
  });

  it("prepends a numeric-preserving summary when history exceeds the window", () => {
    const long = Array.from({ length: 60 }, (_, i) => new HumanMessage(`msg ${i} amount $${i}00`));
    const out = compactHistory(long, { windowSize: 40 });
    expect(out.length).toBeLessThanOrEqual(41); // window + 1 summary
    const summary = out[0];
    expect(String(summary.content)).toMatch(/\$/); // retains dollar figures
    // The window itself is preserved tail-first (last real message is intact).
    expect(out[out.length - 1]).toBe(long[long.length - 1]);
  });

  it("notes how many earlier messages were trimmed", () => {
    const long = Array.from({ length: 60 }, (_, i) => new HumanMessage(`msg ${i}`));
    const out = compactHistory(long, { windowSize: 40 });
    expect(String(out[0].content)).toMatch(/20/); // 60 - 40 dropped
  });
});
