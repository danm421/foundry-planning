import { describe, it, expect } from "vitest";
import { get529Rule, PLAN_529_RULES_2026 } from "../data/five-two-nine-rules";
import { USPS_STATE_CODES } from "@/lib/usps-states";

describe("529 state rules table", () => {
  it("covers every state + DC", () => {
    for (const s of USPS_STATE_CODES) expect(get529Rule(s)).toBeDefined();
  });
  it("NY: per-taxpayer deduction 5k/10k", () => {
    expect(get529Rule("NY")).toMatchObject({ kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000 });
  });
  it("CA: none", () => {
    expect(get529Rule("CA").kind).toBe("none");
  });
  it("IN: 20% credit up to $1,500", () => {
    expect(get529Rule("IN")).toMatchObject({ kind: "credit", creditRate: 0.2, creditMaxSingle: 1_500, creditMaxJoint: 1_500 });
  });
  it("no-income-tax states are none", () => {
    for (const s of ["AK", "FL", "NV", "SD", "TN", "TX", "WA", "WY", "NH"] as const) {
      expect(get529Rule(s).kind).toBe("none");
    }
  });
});
