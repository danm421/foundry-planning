// src/lib/tax/state-income/__tests__/golden/all-states-2025.test.ts
//
// Golden / snapshot suite — all 51 jurisdictions × 2 profiles for tax year 2025.
// See all-states-2026.test.ts for the rationale and regen procedure.

import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../../compute";
import { USPS_STATE_CODES } from "@/lib/usps-states";
import { RETIREE_MFJ_AGE70, WAGE_EARNER_SINGLE_AGE40 } from "./fixtures";
import expectedRetiree from "./golden-expected-2025-retiree.json";
import expectedWage from "./golden-expected-2025-wage.json";

const retireeMap = expectedRetiree as Record<string, number>;
const wageMap = expectedWage as Record<string, number>;

describe("Golden — all 51 jurisdictions 2025", () => {
  describe("retiree-mfj-age70", () => {
    it.each(USPS_STATE_CODES)("%s", (state) => {
      const r = computeStateIncomeTax(RETIREE_MFJ_AGE70(state, 2025));
      const expected = retireeMap[state];
      expect(expected).toBeDefined();
      expect(r.stateTax).toBeCloseTo(expected!, 2);
    });
  });

  describe("wage-earner-single-age40", () => {
    it.each(USPS_STATE_CODES)("%s", (state) => {
      const r = computeStateIncomeTax(WAGE_EARNER_SINGLE_AGE40(state, 2025));
      const expected = wageMap[state];
      expect(expected).toBeDefined();
      expect(r.stateTax).toBeCloseTo(expected!, 2);
    });
  });
});
