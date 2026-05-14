import { describe, it, expect } from "vitest";
import type { SavingsRule } from "@/engine/types";
import { activeSavingsRules } from "../active-savings-rules";

const rule = (
  id: string,
  accountId: string,
  startYear: number,
  endYear: number,
  annualAmount = 1000,
): SavingsRule => ({
  id,
  accountId,
  annualAmount,
  startYear,
  endYear,
  isDeductible: true,
});

describe("activeSavingsRules", () => {
  it("returns rules where currentYear falls within [startYear, endYear]", () => {
    const rules = [
      rule("r1", "a1", 2020, 2030),
      rule("r2", "a2", 2026, 2035),
      rule("r3", "a3", 2030, 2040),
    ];
    expect(activeSavingsRules(rules, 2026).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("excludes rules that haven't started yet", () => {
    const rules = [rule("r1", "a1", 2030, 2040)];
    expect(activeSavingsRules(rules, 2026)).toHaveLength(0);
  });

  it("excludes rules that have already ended", () => {
    const rules = [rule("r1", "a1", 2020, 2024)];
    expect(activeSavingsRules(rules, 2026)).toHaveLength(0);
  });

  it("treats startYear and endYear as inclusive", () => {
    const rules = [rule("r1", "a1", 2026, 2026)];
    expect(activeSavingsRules(rules, 2026)).toHaveLength(1);
  });

  it("returns rules in input order (stable)", () => {
    const rules = [
      rule("r3", "a3", 2026, 2030),
      rule("r1", "a1", 2026, 2030),
      rule("r2", "a2", 2026, 2030),
    ];
    expect(activeSavingsRules(rules, 2026).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
  });
});
