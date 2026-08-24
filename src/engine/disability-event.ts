import type { DisabilityEvent, SuspensionWindow } from "./types";

/**
 * The last year the person is actually disabled, or null when the disability
 * never ends.
 *
 * ⚠️ Clamps an `endYear` that precedes `startYear` up to the start year. The
 * solver's own field prevents that ordering, but a saved scenario, an older
 * draft, or a hand-written payload can still carry it — and read literally it
 * makes the whole stressor INERT rather than loud: an inverted window suspends
 * no year at all, so the paycheck never stops, no policy benefit is paid, and
 * the premium is billed straight through, while the lever's readout still says
 * the policy pays. A one-year disability is the nearest honest reading.
 */
export function lastDisabledYear(event: DisabilityEvent): number | null {
  return event.endYear == null ? null : Math.max(event.endYear, event.startYear);
}

/** The event as a row-level hole, for stamping onto the incomes it stops and
 *  the premiums its waiver-of-premium clause suspends. */
export function disabilitySuspension(event: DisabilityEvent): SuspensionWindow {
  return { fromYear: event.startYear, throughYear: lastDisabledYear(event) };
}
