import { describe, expect, it } from "vitest";

import { condenseAccountName } from "../condense-account-name";

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
