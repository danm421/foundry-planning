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

  it("forbids merging employee and employer rows for the same destination", () => {
    expect(SAVINGS_PROMPT).toMatch(/do not merge/i);
    expect(SAVINGS_PROMPT).toMatch(/separate.*rows in the document/s);
  });

  it("distinguishes Roth from Pre-Tax contributions via rothPercent", () => {
    expect(SAVINGS_PROMPT).toContain("Roth Contribution");
    expect(SAVINGS_PROMPT).toContain("rothPercent");
    expect(SAVINGS_PROMPT).toContain("Pre-Tax Contribution");
    expect(SAVINGS_PROMPT).toContain("omits rothPercent");
  });

  it("maps milestone language to plan tokens", () => {
    expect(SAVINGS_PROMPT).toContain("plan_start");
    expect(SAVINGS_PROMPT).toContain("client_retirement");
    expect(SAVINGS_PROMPT).toContain("spouse_retirement");
    expect(SAVINGS_PROMPT).toContain("plan_end");
  });
});
