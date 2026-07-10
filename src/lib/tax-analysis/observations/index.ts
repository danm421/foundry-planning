import type { Observation, ObservationContext } from "../types";
import { bracketPosition, rothHeadroom, ltcgZeroHeadroom } from "./brackets";
import { irmaaCliff, qcd } from "./retirement";
import {
  charitableBunching, niitExposure, additionalMedicare, safeHarbor, capitalLossCarryover,
} from "./money-flags";
import { ctcPhaseout, educationCredits, stateNotes } from "./credits-state";

const BUILDERS = [
  bracketPosition,
  rothHeadroom,
  ltcgZeroHeadroom,
  qcd,
  irmaaCliff,
  charitableBunching,
  niitExposure,
  additionalMedicare,
  safeHarbor,
  ctcPhaseout,
  educationCredits,
  capitalLossCarryover,
  stateNotes,
] as const;

export function buildObservations(ctx: ObservationContext): Observation[] {
  return BUILDERS.map((b) => b(ctx)).filter((o): o is Observation => o !== null);
}
