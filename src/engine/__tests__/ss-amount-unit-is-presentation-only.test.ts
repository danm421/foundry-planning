// src/engine/__tests__/ss-amount-unit-is-presentation-only.test.ts
import { describe, it, expect } from "vitest";

// `ssAmountUnit` records which unit the advisor TYPED. The engine prices off
// canonical storage (PIA monthly, a stated benefit annual), so no engine file
// may act on the unit — or $5,000/mo and $60,000/yr would project differently.
describe("ssAmountUnit is presentation only", () => {
  it("no file under src/engine reads ssAmountUnit", async () => {
    const { execFileSync } = await import("node:child_process");
    const grep = (pattern: string) => {
      try {
        return execFileSync("/usr/bin/grep", ["-rl", pattern, "src/engine"], { encoding: "utf8" });
      } catch {
        return ""; // grep exits 1 on no match — the passing case
      }
    };
    // `[.]`, not an escaped dot: this file lives under src/engine, and the
    // escaped spelling would match its own source.
    expect(grep("[.]ssAmountUnit").trim()).toBe("");
    const mentions = grep("ssAmountUnit").split("\n").map((f) => f.trim()).filter(Boolean)
      .filter((f) => !f.includes("__tests__")).sort();
    expect(mentions).toEqual(["src/engine/types.ts"]);
  });
});
