import type { Finding, FindingContext } from "../types";
import { bracketPosition, rothHeadroom, ltcgZeroHeadroom } from "./brackets";
import { irmaaCliff, qcd, seRetirementPlanGap } from "./retirement";
import {
  charitableBunching, niitExposure, additionalMedicare, safeHarbor, capitalLossCarryover,
} from "./money-flags";
import { ctcPhaseout, educationCredits, stateNotes } from "./credits-state";
import { rentalCashVsPaper, suspendedPassiveLoss } from "./real-estate";
import { qbiPhaseoutPosition, sCorpElection, seHealthInsurance } from "./business";

const BUILDERS = [
  bracketPosition,
  rothHeadroom,
  ltcgZeroHeadroom,
  qcd,
  irmaaCliff,
  seRetirementPlanGap,
  charitableBunching,
  niitExposure,
  additionalMedicare,
  safeHarbor,
  ctcPhaseout,
  educationCredits,
  capitalLossCarryover,
  rentalCashVsPaper,
  suspendedPassiveLoss,
  qbiPhaseoutPosition,
  sCorpElection,
  seHealthInsurance,
  stateNotes,
] as const;

export function buildFindings(ctx: FindingContext): Finding[] {
  return BUILDERS.map((b) => b(ctx)).filter((f): f is Finding => f !== null);
}
