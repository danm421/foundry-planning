import { describe, expect, it } from "vitest";
import { SAVINGS_PROMPT, SAVINGS_VERSION } from "../prompts/savings";

describe("SAVINGS_PROMPT", () => {
  it("is versioned", () => {
    expect(SAVINGS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("documents the four amount forms seen in real eMoney exports", () => {
    expect(SAVINGS_PROMPT).toContain("% of salary");
    expect(SAVINGS_PROMPT).toContain("per year");
    expect(SAVINGS_PROMPT).toContain("of the first");
    expect(SAVINGS_PROMPT).toContain("contributionRole");
  });

  it("asks for the destination account by name", () => {
    expect(SAVINGS_PROMPT).toContain("destinationAccountName");
  });

  it("forbids guessing", () => {
    expect(SAVINGS_PROMPT).toContain("do not guess");
  });
});
