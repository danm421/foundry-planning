// src/domain/copilot/__tests__/transcript.test.ts
import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import { toUiMessages } from "../transcript";

describe("toUiMessages", () => {
  it("keeps user and assistant prose, drops tool and system messages (round-trip of a full turn)", () => {
    const out = toUiMessages([
      new SystemMessage("you are foundry copilot"),
      new HumanMessage("how is the retirement plan tracking?"),
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "run_projection", args: {} }] }),
      new ToolMessage({ tool_call_id: "c1", content: "{...}" }),
      new AIMessage("The plan funds through age 95 in the base case."),
    ]);
    expect(out).toEqual([
      { role: "user", text: "how is the retirement plan tracking?" },
      { role: "assistant", text: "The plan funds through age 95 in the base case." },
    ]);
  });

  it("skips empty assistant tool-call turns and trims whitespace", () => {
    const out = toUiMessages([
      new HumanMessage("  hi  "),
      new AIMessage({ content: "   ", tool_calls: [{ id: "c1", name: "x", args: {} }] }),
    ]);
    expect(out).toEqual([{ role: "user", text: "hi" }]);
  });

  it("flattens content-part arrays to text", () => {
    const out = toUiMessages([
      new AIMessage({ content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] }),
    ]);
    expect(out).toEqual([{ role: "assistant", text: "part one part two" }]);
  });
});
