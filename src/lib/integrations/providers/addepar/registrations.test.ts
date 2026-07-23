import { describe, it, expect } from "vitest";
import { mapRegistrationType } from "../../map";
import { ADDEPAR_REGISTRATIONS } from "./registrations";

describe("addepar registrations", () => {
  it.each([
    ["Roth IRA", { category: "retirement", subType: "roth_ira" }],
    ["Traditional IRA", { category: "retirement", subType: "traditional_ira" }],
    ["401(k)", { category: "retirement", subType: "401k" }],
    ["Individual", { category: "taxable", subType: "brokerage" }],
    ["Joint Tenants", { category: "taxable", subType: "brokerage" }],
  ])("maps %s", (raw, expected) => {
    expect(mapRegistrationType(raw, ADDEPAR_REGISTRATIONS)).toEqual(expected);
  });
});
