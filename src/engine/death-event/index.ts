// Public surface for the death-event module.
export {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
  splitAccount,
  applyTitling,
  applyBeneficiaryDesignations,
  applyWillSpecificBequests,
  applyWillAllAssetsResidual,
  applyWillResiduary,
  selectResiduaryTier,
  applyFallback,
  applyIncomeTermination,
  distributeFirstDeathUnlinkedLiabilities,
  distributeUnlinkedLiabilities,
  effectiveFilingStatus,
  firesAtDeath,
  runPourOut,
  type DeathEventInput,
  type DeathEventResult,
  type OwnerMutation,
  type SplitShare,
  type SplitAccountResult,
  type StepResult,
  type ExternalBeneficiarySummary,
  type UnlinkedLiabilityDistributionResult,
} from "./shared";
export { applyFirstDeath } from "./first-death";
export { applyFinalDeath } from "./final-death";
export { applyLiabilityBequests } from "./liability-bequests";
export type { LiabilityBequestResult, LiabilityBequestsInput } from "./liability-bequests";
