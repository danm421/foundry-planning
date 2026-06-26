import { describe, it, expect } from "vitest";
import type { ClientData, Income } from "@/engine";
import { ssAmountLabel, ssDetailRows } from "../solver-row-social-security";

function ssRow(p: Partial<Income>): Income {
  return {
    id: "ss",
    type: "social_security",
    owner: "client",
    annualAmount: 0,
    ssBenefitMode: "pia_at_fra",
    piaMonthly: 3600,
    claimingAgeMode: "fra",
    growthRate: 0.02,
    ...p,
  } as Income;
}

const client = { firstName: "Cooper", retirementAge: 65 } as ClientData["client"];

describe("ssAmountLabel", () => {
  it("renders the PIA headline", () => {
    expect(ssAmountLabel(ssRow({}))).toBe("$3,600/mo PIA");
  });
  it("renders a manual annual amount", () => {
    expect(ssAmountLabel(ssRow({ ssBenefitMode: "manual_amount", annualAmount: 30000 }))).toBe(
      "$30,000/yr",
    );
  });
  it("renders No benefit", () => {
    expect(ssAmountLabel(ssRow({ ssBenefitMode: "no_benefit" }))).toBe("No benefit");
  });
});

describe("ssDetailRows", () => {
  it("returns Claim at + COLA rows", () => {
    expect(ssDetailRows(ssRow({}), client, "client")).toEqual([
      { term: "Claim at", value: "FRA" },
      { term: "COLA", value: "2%" },
    ]);
  });
  it("formats a specific claim age", () => {
    const rows = ssDetailRows(
      ssRow({ claimingAgeMode: "years", claimingAge: 70, claimingAgeMonths: 0, growthRate: undefined }),
      client,
      "client",
    );
    expect(rows).toEqual([{ term: "Claim at", value: "70" }]);
  });
  it("is empty for no_benefit", () => {
    expect(ssDetailRows(ssRow({ ssBenefitMode: "no_benefit" }), client, "client")).toEqual([]);
  });
});
