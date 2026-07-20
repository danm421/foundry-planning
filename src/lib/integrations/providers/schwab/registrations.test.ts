import { describe, expect, it } from "vitest";
import { mapRegistrationType } from "../../map";
import { SCHWAB_REGISTRATIONS } from "./registrations";

describe("Schwab registration types", () => {
  it.each([
    ["Roth IRA", "retirement", "roth_ira"],
    ["Roth Contributory IRA", "retirement", "roth_ira"],
    ["Rollover IRA", "retirement", "traditional_ira"],
    ["SEP-IRA", "retirement", "traditional_ira"],
    ["SIMPLE IRA", "retirement", "traditional_ira"],
    ["Inherited IRA", "retirement", "traditional_ira"],
    ["Company Retirement Account", "retirement", "401k"],
    ["Individual 401(k)", "retirement", "401k"],
    ["403(b)(7)", "retirement", "403b"],
    ["Roth Individual 401(k)", "retirement", "401k"],
    ["Roth 403(b)", "retirement", "403b"],
    ["Education Savings Account", "taxable", "529"],
    ["529 Plan", "taxable", "529"],
    ["Schwab One Individual", "taxable", "brokerage"],
    ["Joint Tenants with Rights of Survivorship", "taxable", "brokerage"],
    ["Community Property", "taxable", "brokerage"],
    ["Custodial UTMA", "taxable", "brokerage"],
    ["Revocable Living Trust", "taxable", "brokerage"],
  ])("maps %s", (raw, category, subType) => {
    const r = mapRegistrationType(raw, SCHWAB_REGISTRATIONS);
    expect(r).toMatchObject({ category, subType });
    expect(r.warning).toBeUndefined();
  });

  it("warns and defaults on an unrecognized registration", () => {
    const r = mapRegistrationType("Donor Advised Fund", SCHWAB_REGISTRATIONS);
    expect(r).toMatchObject({ category: "taxable", subType: "brokerage" });
    expect(r.warning).toContain("Donor Advised Fund");
  });
});
