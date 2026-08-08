import type { Finding, FindingContext } from "../types";
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

export function buildFindings(ctx: FindingContext): Finding[] {
  return BUILDERS.map((b) => b(ctx)).filter((f): f is Finding => f !== null);
}
