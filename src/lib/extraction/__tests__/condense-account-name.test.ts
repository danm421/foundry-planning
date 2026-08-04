import { describe, expect, it } from "vitest";

import { composeAccountName, condenseAccountName } from "../condense-account-name";

describe("condenseAccountName", () => {
  it("strips a masked account-number fragment", () => {
    expect(condenseAccountName("Fidelity Rollover IRA XXXX-1234")).toBe(
      "Fidelity Rollover IRA",
    );
    expect(condenseAccountName("Schwab Brokerage ****5678")).toBe(
      "Schwab Brokerage",
    );
  });

  it("strips a bare long digit run but keeps short meaningful numbers", () => {
    expect(condenseAccountName("Chase Checking 123456789")).toBe("Chase Checking");
    expect(condenseAccountName("Fidelity 401k")).toBe("Fidelity 401k");
    expect(condenseAccountName("Vanguard 529 Plan")).toBe("Vanguard 529 Plan");
  });

  it("collapses whitespace and trims separator debris", () => {
    expect(condenseAccountName("  Fidelity   Rollover  IRA  -  ")).toBe(
      "Fidelity Rollover IRA",
    );
  });

  it("caps length at 60 characters without cutting mid-word", () => {
    const long =
      "John A Smith and Jane B Smith JTWROS Rollover Individual Retirement Arrangement";
    const result = condenseAccountName(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith(" ")).toBe(false);
    expect(long.startsWith(result)).toBe(true);
  });

  it("is idempotent", () => {
    const once = condenseAccountName("Fidelity Rollover IRA XXXX-1234");
    expect(condenseAccountName(once)).toBe(once);
  });

  it("returns an empty string unchanged rather than throwing", () => {
    expect(condenseAccountName("")).toBe("");
    expect(condenseAccountName("   ")).toBe("");
  });

  it("never returns empty for a name that is only an account number", () => {
    expect(condenseAccountName("XXXX-1234")).toBe("XXXX-1234");
  });
});

describe("composeAccountName", () => {
  it("drops a leading custodian the model added anyway", () => {
    expect(composeAccountName("Fidelity Rollover IRA", "Fidelity")).toBe("Rollover IRA");
    // Only a PART of the custodian appears in the name — still the custodian.
    expect(composeAccountName("Schwab Joint Brokerage", "Charles Schwab")).toBe(
      "Joint Brokerage",
    );
  });

  it("drops a trailing custodian", () => {
    expect(composeAccountName("Joint Brokerage - Schwab", "Charles Schwab")).toBe(
      "Joint Brokerage",
    );
  });

  it("keeps words the custodian does not contain", () => {
    expect(composeAccountName("Bank Loan Reserve", "Chase")).toBe("Bank Loan Reserve");
  });

  it("keeps a custodian-only name rather than returning empty", () => {
    expect(composeAccountName("Fidelity", "Fidelity")).toBe("Fidelity");
  });

  it("appends the masked last 4 when the document showed one", () => {
    expect(composeAccountName("Fidelity Rollover IRA", "Fidelity", "1234")).toBe(
      "Rollover IRA ••••1234",
    );
  });

  it("does not double-mask an already-masked last4 field", () => {
    expect(composeAccountName("Rollover IRA", null, "****1234")).toBe(
      "Rollover IRA ••••1234",
    );
    expect(composeAccountName("Rollover IRA", null, "XXXX-1234")).toBe(
      "Rollover IRA ••••1234",
    );
  });

  it("does not print the digits twice when the name already ends in them", () => {
    expect(composeAccountName("Rollover IRA 1234", null, "1234")).toBe(
      "Rollover IRA ••••1234",
    );
  });

  it("keeps meaningful short numbers that are not the last4", () => {
    expect(composeAccountName("Vanguard 529 Plan", "Vanguard", "8899")).toBe(
      "529 Plan ••••8899",
    );
  });

  it("falls back to the mask alone when nothing else survives", () => {
    expect(composeAccountName("XXXX-1234", null, "1234")).toBe("••••1234");
  });

  it("is a no-op beyond condensing when custodian and last4 are absent", () => {
    expect(composeAccountName("Chase Checking 123456789")).toBe("Chase Checking");
  });

  it("caps the composed name, suffix included, at 60 characters", () => {
    const long =
      "John A Smith and Jane B Smith JTWROS Rollover Individual Retirement Arrangement";
    const result = composeAccountName(long, null, "1234");
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith("••••1234")).toBe(true);
  });

  it("is idempotent", () => {
    const once = composeAccountName("Fidelity Rollover IRA XXXX-1234", "Fidelity", "1234");
    expect(once).toBe("Rollover IRA ••••1234");
    expect(composeAccountName(once, "Fidelity", "1234")).toBe(once);
  });

  it("tolerates non-string custodian / last4 from the loose extraction schema", () => {
    const bad = 1234 as unknown as string;
    expect(composeAccountName("Rollover IRA", bad, bad)).toBe("Rollover IRA");
  });
});
