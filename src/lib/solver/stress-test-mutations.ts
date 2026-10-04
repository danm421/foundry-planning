import type { StressTestKind, StressTestParams } from "@/engine/types";
import type { SolverMutation } from "./types";

export type StressMutationKind =
  | "stress-inflation"
  | "stress-ss-haircut"
  | "stress-tax-rates"
  | "stress-disability"
  | "stress-market-crash"
  | "stress-exemption-cap";

/** The six stressors a `stress_test` change can hold (LTC has its own kind). */
export type StressMutation = Extract<SolverMutation, { kind: StressMutationKind }>;

/** Each saved kind's draft mutation kind — also its `SolverMutationKey`. */
export const STRESS_MUTATION_KIND: Record<StressTestKind, StressMutationKind> = {
  inflation: "stress-inflation",
  "ss-haircut": "stress-ss-haircut",
  "tax-rates": "stress-tax-rates",
  disability: "stress-disability",
  "market-crash": "stress-market-crash",
  "exemption-cap": "stress-exemption-cap",
};

export function stressParamsFromMutation(m: StressMutation): StressTestParams {
  switch (m.kind) {
    case "stress-inflation":
      return { kind: "inflation", rate: m.rate };
    case "stress-ss-haircut":
      return { kind: "ss-haircut", pct: m.pct, startYear: m.startYear };
    case "stress-tax-rates":
      return { kind: "tax-rates", points: m.points, startYear: m.startYear };
    case "stress-disability":
      return { kind: "disability", person: m.person, startYear: m.startYear, endYear: m.endYear };
    case "stress-market-crash":
      return { kind: "market-crash", year: m.year, drawdownPct: m.drawdownPct };
    case "stress-exemption-cap":
      return { kind: "exemption-cap", cap: m.cap };
  }
}

export function stressMutationFromParams(p: StressTestParams): StressMutation {
  switch (p.kind) {
    case "inflation":
      return { kind: "stress-inflation", rate: p.rate };
    case "ss-haircut":
      return { kind: "stress-ss-haircut", pct: p.pct, startYear: p.startYear };
    case "tax-rates":
      return { kind: "stress-tax-rates", points: p.points, startYear: p.startYear };
    case "disability":
      return { kind: "stress-disability", person: p.person, startYear: p.startYear, endYear: p.endYear };
    case "market-crash":
      return { kind: "stress-market-crash", year: p.year, drawdownPct: p.drawdownPct };
    case "exemption-cap":
      return { kind: "stress-exemption-cap", cap: p.cap };
  }
}

/** Draft keys a saved stressor makes stale. Once a scenario holds a kind (on
 *  or off) the saved change is the truth; a leftover draft restored from
 *  browser storage would otherwise drive the preview on every tab. */
export function staleStressDraftKeys(
  savedKinds: Iterable<StressTestKind>,
  draftKeys: { has(key: string): boolean },
): StressMutationKind[] {
  return [...savedKinds].map((k) => STRESS_MUTATION_KIND[k]).filter((key) => draftKeys.has(key));
}
