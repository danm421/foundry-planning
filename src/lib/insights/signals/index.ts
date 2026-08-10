import { riskSignals } from "./risk";
import { taxSignals } from "./tax";
import { planSignals } from "./plan";
import { portfolioSignals } from "./portfolio";
import { relationshipSignals } from "./relationship";
import { orderSignals } from "./order";
import type { Signal, SignalInput } from "./types";

export type { Signal, SignalInput, SignalSeverity, SignalDomain } from "./types";
export { orderSignals } from "./order";

/**
 * Every deterministic signal for a household, in triage order.
 *
 * Pure: no IO, no clock. `input.now` is supplied by the caller so the whole
 * layer is testable without mocking time.
 */
export function buildSignals(input: SignalInput): Signal[] {
  return orderSignals([
    ...riskSignals(input),
    ...taxSignals(input),
    ...planSignals(input),
    ...portfolioSignals(input),
    ...relationshipSignals(input),
  ]);
}
