import { describe, it, expect } from "vitest";
import { PAY_STUB_PROMPT, PAY_STUB_VERSION } from "../pay-stub";
import { TAX_RETURN_PROMPT, TAX_RETURN_VERSION } from "../tax-return";

describe("prompts request the reconciliation facts", () => {
  it("pay stub asks for all four income facts plus savings employer", () => {
    for (const key of ["employer", "sourceTaxYear", "basis", "recurrence"]) {
      expect(PAY_STUB_PROMPT).toContain(`"${key}"`);
    }
    expect(PAY_STUB_PROMPT).toContain("annualized");
    expect(PAY_STUB_PROMPT).toContain("recurring");
  });

  it("tax return asks for employer and sourceTaxYear and marks amounts actual", () => {
    for (const key of ["employer", "sourceTaxYear", "basis"]) {
      expect(TAX_RETURN_PROMPT).toContain(`"${key}"`);
    }
    expect(TAX_RETURN_PROMPT).toContain("actual");
  });

  it("both versions were bumped past their pre-change values", () => {
    expect(PAY_STUB_VERSION).not.toBe("2026-08-04.2");
    expect(TAX_RETURN_VERSION).not.toBe("2026-08-06.1");
  });
});
