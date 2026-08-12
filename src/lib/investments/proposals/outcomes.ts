import type { OutcomeCone, OutcomeRow } from "./types";

/** Standard normal quantile at the 90th percentile; −z is the 10th. */
const Z_90 = 1.2815515655446004;

export interface SideAssumptions {
  arithmeticMean: number;
  stdDev: number;
}

export interface BuildOutcomeConeInput {
  startValue: number;
  current: SideAssumptions;
  proposed: SideAssumptions;
  years: readonly number[];
}

/**
 * Lognormal growth band for a portfolio held untouched.
 *
 * This is NOT the Monte Carlo engine: there are no cash flows, no withdrawals,
 * no taxes and no sequence risk. It answers "what could this pot of money do
 * on its own", which is a different question from plan confidence — the report
 * must label it as such or an advisor will read it against the plan's Monte
 * Carlo number and find two answers to what looks like one question.
 */
function rowsFor(side: SideAssumptions, startValue: number, years: readonly number[]): OutcomeRow[] {
  return years.map((t) => {
    const drift = (side.arithmeticMean - (side.stdDev ** 2) / 2) * t;
    const spread = side.stdDev * Math.sqrt(t);
    return {
      years: t,
      p10: startValue * Math.exp(drift - Z_90 * spread),
      p50: startValue * Math.exp(drift),
      p90: startValue * Math.exp(drift + Z_90 * spread),
    };
  });
}

export function buildOutcomeCone(input: BuildOutcomeConeInput): OutcomeCone {
  return {
    startValue: input.startValue,
    current: rowsFor(input.current, input.startValue, input.years),
    proposed: rowsFor(input.proposed, input.startValue, input.years),
  };
}
