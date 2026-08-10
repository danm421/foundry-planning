import type { Finding, FindingContext } from "../types";
import { bracketPosition, rothHeadroom, ltcgZeroHeadroom } from "./brackets";
import { irmaaCliff, qcd, seRetirementPlanGap } from "./retirement";
import {
  charitableBunching, niitExposure, additionalMedicare, safeHarbor, capitalLossCarryover,
} from "./money-flags";
import { ctcPhaseout, educationCredits, stateNotes } from "./credits-state";
import { rentalCashVsPaper, suspendedPassiveLoss } from "./real-estate";
import {
  qbiPhaseoutPosition, sCorpElection, seHealthInsurance,
  guaranteedPaymentsSeTax, businessLossMix, reasonableCompensation,
} from "./business";

/**
 * ⚠️ This order is LOAD-BEARING, not an import-grouping artifact. `sortFindings`
 * breaks every tie on the finding's original index (order.ts), so for findings
 * of equal severity with equal — or both-null — `estimatedImpact`, the order
 * here IS the order the advisor and the client's PDF see. Alphabetizing this
 * array, or letting an import organizer sort it, silently reorders the report
 * and reddens the PDF's hard-coded expected-order assertion.
 */
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
  stateNotes,
  rentalCashVsPaper,
  suspendedPassiveLoss,
  qbiPhaseoutPosition,
  sCorpElection,
  seHealthInsurance,
  guaranteedPaymentsSeTax,
  businessLossMix,
  reasonableCompensation,
] as const;

export function buildFindings(ctx: FindingContext): Finding[] {
  return BUILDERS.map((b) => b(ctx)).filter((f): f is Finding => f !== null);
}
