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
  applyFallback,
  applyIncomeTermination,
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
