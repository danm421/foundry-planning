import type { EquityStrategy } from "./types";

/** Account default is always fully populated. */
export interface ResolvedStrategy {
  exerciseTiming: NonNullable<EquityStrategy["exerciseTiming"]>;
  exerciseYear: number | null;
  sellTiming: NonNullable<EquityStrategy["sellTiming"]>;
  sellYear: number | null;
  sellPercentPerYear: number | null;
  sellStartYear: number | null;
}

/** Pick the first non-null value across tranche → grant → account for each field. */
export function resolveStrategy(
  account: EquityStrategy,
  grant: EquityStrategy | null | undefined,
  tranche: EquityStrategy | null | undefined,
): ResolvedStrategy {
  const pick = <K extends keyof EquityStrategy>(k: K): EquityStrategy[K] =>
    tranche?.[k] ?? grant?.[k] ?? account[k];
  return {
    exerciseTiming: (pick("exerciseTiming") ?? "at_vest") as ResolvedStrategy["exerciseTiming"],
    exerciseYear: pick("exerciseYear") ?? null,
    sellTiming: (pick("sellTiming") ?? "hold") as ResolvedStrategy["sellTiming"],
    sellYear: pick("sellYear") ?? null,
    sellPercentPerYear: pick("sellPercentPerYear") ?? null,
    sellStartYear: pick("sellStartYear") ?? null,
  };
}
