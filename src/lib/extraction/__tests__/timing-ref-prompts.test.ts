import { describe, it, expect } from "vitest";
import { INCOME_SUMMARY_PROMPT } from "@/lib/extraction/prompts/income-summary";
import { EXPENSE_WORKSHEET_PROMPT } from "@/lib/extraction/prompts/expense-worksheet";

describe("timing-ref prompt vocabulary", () => {
  for (const [label, prompt] of [
    ["income", INCOME_SUMMARY_PROMPT],
    ["expense", EXPENSE_WORKSHEET_PROMPT],
  ] as const) {
    it(`${label} prompt documents ref fields + vocabulary + guardrail`, () => {
      expect(prompt).toContain("startYearRef");
      expect(prompt).toContain("endYearRef");
      expect(prompt).toContain("client_retirement");
      expect(prompt).toContain("client_end");
      expect(prompt).toContain("plan_start");
      // guardrail: only on explicit milestone language
      expect(prompt.toLowerCase()).toContain("only");
    });
  }

  it("expense prompt now extracts start/end years", () => {
    expect(EXPENSE_WORKSHEET_PROMPT).toContain("startYear");
    expect(EXPENSE_WORKSHEET_PROMPT).toContain("endYear");
  });
});
