import { describe, it, expect } from "vitest";
import { formatLineRefs } from "../findings/line-refs";

describe("formatLineRefs", () => {
  it("prints the form once per run and collapses repeats — the spec's worked example", () => {
    expect(
      formatLineRefs([
        { form: "Schedule E", line: "line 3", label: "Rents received", amount: 19600 },
        { form: "Schedule E", line: "line 18", label: "Depreciation", amount: 8413 },
        { form: "Schedule E", line: "line 20", label: "Total expenses", amount: 25741 },
        { form: "Schedule 1", line: "line 5", label: "Rental real estate", amount: -6141 },
      ]),
    ).toBe("Schedule E line 3 · line 18 · line 20 · Schedule 1 line 5");
  });

  it("re-prints a form that returns after another form intervened", () => {
    expect(
      formatLineRefs([
        { form: "Form 1040", line: "line 11", label: "AGI", amount: 1 },
        { form: "Schedule A", line: "line 11", label: "Gifts", amount: 2 },
        { form: "Form 1040", line: "line 12", label: "Deduction", amount: 3 },
      ]),
    ).toBe("Form 1040 line 11 · Schedule A line 11 · Form 1040 line 12");
  });

  it("returns an empty string for no refs, so the footer can be skipped", () => {
    expect(formatLineRefs([])).toBe("");
  });
});
