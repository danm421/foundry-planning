import { describe, it, expect } from "vitest";
import { TextWidgetConfigSchema } from "../layout-schema";

describe("TextWidgetConfigSchema", () => {
  it("accepts a legacy config with only markdown", () => {
    const r = TextWidgetConfigSchema.safeParse({ markdown: "hello" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.markdown).toBe("hello");
      expect(r.data.ai).toBeUndefined();
    }
  });

  it("accepts a config with an AI block", () => {
    const r = TextWidgetConfigSchema.safeParse({
      markdown: "x",
      ai: {
        sources: { groupIds: ["g1"], cellIds: ["c1"] },
        tone: "concise",
        length: "medium",
        customInstructions: "use plain English",
        lastGenerated: { hash: "abc", at: "2026-05-12T00:00:00Z", cached: false },
      },
    });
    expect(r.success).toBe(true);
  });

  it("defaults missing scalar fields to safe values", () => {
    const r = TextWidgetConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.markdown).toBe("");
  });

  it("rejects an invalid tone", () => {
    const r = TextWidgetConfigSchema.safeParse({
      markdown: "x",
      ai: {
        sources: { groupIds: [], cellIds: [] },
        tone: "sassy",
        length: "short",
        customInstructions: "",
      },
    });
    expect(r.success).toBe(false);
  });
});
