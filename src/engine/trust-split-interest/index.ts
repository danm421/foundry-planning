export { computeAnnualUnitrustPayment } from "./compute-annual-payment";
export type {
  AnnualPaymentInput,
  AnnualPaymentResult,
} from "./compute-annual-payment";
export {
  isTrustTerminationYear,
  distributeAtTermination,
} from "./trust-termination";
export type {
  TerminationContext,
  TerminationDeathYears,
  TrustTerminationResult,
} from "./trust-termination";
export { computeClutRecapture } from "./recapture";
export type { RecaptureInput, RecaptureResult } from "./recapture";
