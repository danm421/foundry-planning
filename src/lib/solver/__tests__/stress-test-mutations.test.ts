import { describe, it, expect } from "vitest";
import {
  STRESS_MUTATION_KIND,
  staleStressDraftKeys,
  stressMutationFromParams,
  stressParamsFromMutation,
  type StressMutation,
} from "../stress-test-mutations";

const mutations: StressMutation[] = [
  { kind: "stress-inflation", rate: 0.05 },
  { kind: "stress-ss-haircut", pct: 0.23, startYear: 2034 },
  { kind: "stress-tax-rates", points: 0.03, startYear: 2027 },
  { kind: "stress-disability", person: "spouse", startYear: 2027, endYear: 2030 },
  { kind: "stress-market-crash", year: 2027, drawdownPct: 0.3 },
  { kind: "stress-exemption-cap", cap: 7_000_000 },
];

describe("stress mutation ↔ params", () => {
  it.each(mutations)("$kind round-trips", (m) => {
    const params = stressParamsFromMutation(m);
    expect(STRESS_MUTATION_KIND[params.kind]).toBe(m.kind);
    expect(stressMutationFromParams(params)).toEqual(m);
  });
});

describe("staleStressDraftKeys", () => {
  it("returns the draft key of every saved kind that still has a draft", () => {
    const drafts = new Set(["stress-market-crash", "stress-ltc", "living-expense-scale"]);
    expect(staleStressDraftKeys(["market-crash", "inflation"], drafts)).toEqual(["stress-market-crash"]);
  });

  it("returns nothing when no saved kind has a draft", () => {
    expect(staleStressDraftKeys(["inflation"], new Set<string>())).toEqual([]);
  });
});
