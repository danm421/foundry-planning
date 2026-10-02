"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFocusCloseOnce, type FocusCloseOutcome } from "@/hooks/use-focus-close-once";
import DialogShell from "@/components/dialog-shell";
import { useClientAccess } from "@/components/client-access-provider";
import { ASSUMPTIONS_TABS, assumptionsTabQuery, resolveAssumptionsTab } from "./tabs";
import AssumptionsSubtabs from "@/components/assumptions-subtabs";
import TaxRatesForm from "@/components/forms/tax-rates-form";
import GrowthInflationForm from "@/components/forms/growth-inflation-form";
import SurplusCashFlowForm from "@/components/forms/surplus-cash-flow-form";
import WithdrawalStrategySection from "@/components/withdrawal-strategy-section";
import type { WithdrawalAccount, WithdrawalStrategy } from "@/components/withdrawal-strategy-section";
import type { ClientMilestones } from "@/lib/milestones";
import { DeductionsClient } from "./deductions-client";
import { DeductionsItemizedList } from "@/components/deductions-itemized-list";
import { TaxAdjustmentsList } from "@/components/tax-adjustments-list";
import AccountGroupsTab from "./account-groups-tab";
import type {
  DerivedRow,
  ExpenseDeductionRow,
  MortgageInterestRow,
  PropertyTaxRow,
} from "@/components/deductions-derived-summary";
import type { LiquidAccount, AssetAccount } from "@/components/account-groups/types";
import { type RiskLevel } from "@/lib/risk-levels";
import type { FilingStatus } from "@/lib/tax/types";
import type { TaxAdjustmentRow } from "@/components/forms/add-tax-adjustment-form";
import { focusRowId, type EditorFocus } from "@/lib/scenario/change-editor-target";

export interface DeductionsTabData {
  derivedRows: DerivedRow[];
  expenseDeductionRows: ExpenseDeductionRow[];
  mortgageRows: MortgageInterestRow[];
  propertyTaxRows: PropertyTaxRow[];
  itemizedRows: {
    id: string;
    type: "charitable" | "above_line" | "below_line" | "property_tax";
    name: string | null;
    owner: "client" | "spouse" | "joint";
    annualAmount: number;
    growthRate: number;
    startYear: number;
    endYear: number;
    startYearRef: string | null;
    endYearRef: string | null;
  }[];
  currentYear: number;
  saltCap: number;
}

export interface AssumptionsSettings {
  flatFederalRate: string;
  flatStateRate: string;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  residenceState: import("@/lib/usps-states").USPSStateCode | null;
  irdTaxRate: string;
  probateCostRate: string;
  pvDiscountRate: string;
  inflationRate: string;
  inflationRateSource: "asset_class" | "custom";
  planStartYear: number;
  planEndYear: number;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
  growthSourceTaxable?: string;
  growthSourceCash?: string;
  growthSourceRetirement?: string;
  growthSourceRealEstate?: string;
  growthSourceBusiness?: string;
  growthSourceLifeInsurance?: string;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  taxEngineMode: "flat" | "bracket";
  taxInflationRate: string;
  lifetimeExemptionCap: string;
  ssWageGrowthRate: string;
  medicarePremiumInflationRate: string;
  medicarePremiumInflationEnabled: boolean;
  outOfHouseholdDniRate: string;
  priorTaxableGiftsClient: string;
  priorTaxableGiftsSpouse: string;
  capitalLossCarryforwardSt: string;
  capitalLossCarryforwardLt: string;
  capitalLossCarryforwardLtSourceYear: number | null;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
  surplusSpendAllUntilRetirement: boolean;
  coveredByWorkplacePlan: "auto" | "yes" | "no";
  spouseCoveredByWorkplacePlan: "auto" | "yes" | "no";
}

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
  riskLevel: RiskLevel | null;
}

export interface AssumptionsClientProps {
  clientId: string;
  /** The scenario being viewed, when the loader was asked for one — titles the
   *  Solver's focus dialog. */
  scenarioName?: string;
  /** The household's composite risk level (Task 9+), falling back to the
   *  legacy `clients.riskTolerance` column when no profile row exists yet --
   *  resolved by the server component so this stays a plain read-only value. */
  riskLevel?: RiskLevel | null;
  /** Household filing status — quoted in the §1211(b) capital-loss field help
   *  ($1,500 for MFS, $3,000 otherwise). */
  filingStatus?: FilingStatus;
  settings: AssumptionsSettings;
  accounts: WithdrawalAccount[];
  withdrawalStrategies: WithdrawalStrategy[];
  milestones?: ClientMilestones;
  modelPortfolios?: ModelPortfolioOption[];
  clientFirstName?: string;
  spouseFirstName?: string;
  resolvedInflationRate: number;
  assetClassInflationRate: number;
  hasInflationAssetClass: boolean;
  deductionsData: DeductionsTabData;
  taxAdjustmentRows: TaxAdjustmentRow[];
  liquidAccounts: LiquidAccount[];
  allAccounts: AssetAccount[];
  /**
   * Focus mode, for the Solver's Changes tab. Read once, at mount — key the
   * view by the focus. Renders only the editor the focus names, over nothing:
   * - a `client_deduction` / `client_tax_adjustment` / `withdrawal_strategy`
   *   edit, create or delete → that list's own form (a delete runs silently);
   * - `plan_settings` with id `"withdrawal"` or `"tax-rates"` → that tab, in a
   *   dialog; both save through `usePlanSettingsAutosave`, which writes the
   *   scenario when one is active.
   * Anything else reports `"unavailable"` (Growth & Inflation is not wired
   * yet).
   */
  focus?: EditorFocus;
  /**
   * Called once when focus mode ends. The host must UNMOUNT the view then
   * (clearing `focus` on a still-mounted view falls through to the full page).
   * The outcome is `"unavailable"` when no editor opened, `"failed"` when a
   * focused delete did not land.
   */
  onFocusClose?: (outcome?: FocusCloseOutcome) => void;
}

/** Stable "found" marker for the singleton dialog (a fresh `{}` per render would re-run the close hook's effect). */
const SINGLETON_FOUND = {};

/** The Assumptions singletons a focus can open as a dialog. */
const SINGLETON_TABS = ["tax-rates", "withdrawal"] as const;
type SingletonTab = (typeof SINGLETON_TABS)[number];

/** The focus kinds whose list opens its own editor, as that list's focus mode. */
const ROW_FOCUS_KINDS = ["client_deduction", "client_tax_adjustment", "withdrawal_strategy"] as const;
type RowFocusKind = (typeof ROW_FOCUS_KINDS)[number];

export default function AssumptionsClient({
  clientId,
  scenarioName,
  riskLevel,
  filingStatus,
  settings,
  accounts,
  withdrawalStrategies,
  milestones,
  modelPortfolios,
  clientFirstName,
  spouseFirstName,
  resolvedInflationRate,
  assetClassInflationRate,
  hasInflationAssetClass,
  deductionsData,
  taxAdjustmentRows,
  liquidAccounts,
  allAccounts,
  focus,
  onFocusClose,
}: AssumptionsClientProps) {
  // Tab lives in the URL so the risk detail card can deep-link to
  // ?tab=growth-inflation, and so the back button steps through tabs.
  const searchParams = useSearchParams();
  const activeTab = resolveAssumptionsTab(searchParams.get("tab"));

  const { permission } = useClientAccess();
  const canEdit = permission === "edit";

  // Focus mode, read once. A row kind's list owns its own close handshake; the
  // Savings & Withdrawals singleton is a dialog this view owns.
  const [rowFocusKind] = useState<RowFocusKind | null>(() =>
    focus && canEdit ? (ROW_FOCUS_KINDS.find((k) => k === focus.kind) ?? null) : null,
  );
  const [singletonTab] = useState<SingletonTab | null>(() => {
    if (!focus || !canEdit || focus.kind !== "plan_settings") return null;
    return SINGLETON_TABS.find((t) => t === focusRowId(focus)) ?? null;
  });
  const [singletonDialogOpen, setSingletonDialogOpen] = useState(singletonTab !== null);
  // Reports "unavailable" for every focus no editor opens for (a row kind
  // handed to its list does not come through here), and closes the dialog's.
  useFocusCloseOnce(
    rowFocusKind ? undefined : focus,
    singletonTab ? SINGLETON_FOUND : null,
    singletonDialogOpen,
    onFocusClose,
  );

  const taxRatesTab = (
    <TaxRatesForm
      clientId={clientId}
      flatFederalRate={settings.flatFederalRate}
      flatStateRate={settings.flatStateRate}
      estateAdminExpenses={settings.estateAdminExpenses}
      flatStateEstateRate={settings.flatStateEstateRate}
      residenceState={settings.residenceState}
      irdTaxRate={settings.irdTaxRate}
      probateCostRate={settings.probateCostRate}
      pvDiscountRate={settings.pvDiscountRate}
      lifetimeExemptionCap={settings.lifetimeExemptionCap}
      outOfHouseholdDniRate={settings.outOfHouseholdDniRate}
      priorTaxableGiftsClient={settings.priorTaxableGiftsClient}
      priorTaxableGiftsSpouse={settings.priorTaxableGiftsSpouse}
      coveredByWorkplacePlan={settings.coveredByWorkplacePlan}
      spouseCoveredByWorkplacePlan={settings.spouseCoveredByWorkplacePlan}
      capitalLossCarryforwardSt={settings.capitalLossCarryforwardSt}
      capitalLossCarryforwardLt={settings.capitalLossCarryforwardLt}
      capitalLossCarryforwardLtSourceYear={settings.capitalLossCarryforwardLtSourceYear}
      filingStatus={filingStatus}
      hasSpouse={Boolean(spouseFirstName)}
      clientFirstName={clientFirstName}
      spouseFirstName={spouseFirstName}
      initialMode={settings.taxEngineMode}
    />
  );

  const withdrawalTab = (
    <div className="space-y-8">
      <SurplusCashFlowForm
        clientId={clientId}
        surplusSpendPct={settings.surplusSpendPct}
        surplusSaveAccountId={settings.surplusSaveAccountId}
        surplusSpendAllUntilRetirement={settings.surplusSpendAllUntilRetirement}
        householdAccounts={accounts
          .filter((a) => !a.ownerEntityId)
          .map((a) => ({ id: a.id, name: a.name }))}
      />
      <WithdrawalStrategySection
        clientId={clientId}
        accounts={accounts}
        initialStrategies={withdrawalStrategies}
        milestones={milestones}
        clientFirstName={clientFirstName}
        spouseFirstName={spouseFirstName}
      />
    </div>
  );

  if (focus) {
    const intent = focus.intent ?? "edit";
    const rowFocus = { focusIntent: intent, focusRowId: focusRowId(focus), onFocusClose };
    if (rowFocusKind === "client_deduction") {
      return (
        <DeductionsItemizedList
          clientId={clientId}
          rows={deductionsData.itemizedRows}
          currentYear={deductionsData.currentYear}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          {...rowFocus}
        />
      );
    }
    if (rowFocusKind === "client_tax_adjustment") {
      return (
        <TaxAdjustmentsList
          clientId={clientId}
          rows={taxAdjustmentRows}
          currentYear={deductionsData.currentYear}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          {...rowFocus}
        />
      );
    }
    if (rowFocusKind === "withdrawal_strategy") {
      return (
        <WithdrawalStrategySection
          clientId={clientId}
          accounts={accounts}
          initialStrategies={withdrawalStrategies}
          milestones={milestones}
          clientFirstName={clientFirstName}
          spouseFirstName={spouseFirstName}
          {...rowFocus}
        />
      );
    }
    if (!singletonDialogOpen || !singletonTab) return null;
    const label = ASSUMPTIONS_TABS.find((t) => t.id === singletonTab)!.label;
    return (
      <DialogShell
        open
        onOpenChange={(open) => !open && setSingletonDialogOpen(false)}
        title={scenarioName ? `${label} — ${scenarioName}` : label}
        size="lg"
      >
        {singletonTab === "tax-rates" ? taxRatesTab : withdrawalTab}
      </DialogShell>
    );
  }

  function handleTabChange(id: string) {
    // pushState (not router.push) -- syncs useSearchParams without re-running
    // the server tree, which on this page is an expensive DB read.
    window.history.pushState(null, "", assumptionsTabQuery(searchParams, id));
  }

  return (
    <div className="space-y-6">
      <AssumptionsSubtabs tabs={ASSUMPTIONS_TABS} activeTab={activeTab} onTabChange={handleTabChange} />

      <div className="rounded-lg border border-hair bg-card p-6">
        {activeTab === "tax-rates" && taxRatesTab}
        {activeTab === "growth-inflation" && (
          <GrowthInflationForm
            clientId={clientId}
            riskLevel={riskLevel}
            inflationRate={settings.inflationRate}
            inflationRateSource={settings.inflationRateSource}
            resolvedInflationRate={resolvedInflationRate}
            assetClassInflationRate={assetClassInflationRate}
            hasInflationAssetClass={hasInflationAssetClass}
            defaultGrowthTaxable={settings.defaultGrowthTaxable}
            defaultGrowthCash={settings.defaultGrowthCash}
            defaultGrowthRetirement={settings.defaultGrowthRetirement}
            defaultGrowthRealEstate={settings.defaultGrowthRealEstate}
            defaultGrowthBusiness={settings.defaultGrowthBusiness}
            defaultGrowthLifeInsurance={settings.defaultGrowthLifeInsurance}
            growthSourceTaxable={settings.growthSourceTaxable}
            growthSourceCash={settings.growthSourceCash}
            growthSourceRetirement={settings.growthSourceRetirement}
            growthSourceRealEstate={settings.growthSourceRealEstate}
            growthSourceBusiness={settings.growthSourceBusiness}
            growthSourceLifeInsurance={settings.growthSourceLifeInsurance}
            modelPortfolioIdTaxable={settings.modelPortfolioIdTaxable}
            modelPortfolioIdCash={settings.modelPortfolioIdCash}
            modelPortfolioIdRetirement={settings.modelPortfolioIdRetirement}
            modelPortfolios={modelPortfolios}
            taxInflationRate={settings.taxInflationRate}
            ssWageGrowthRate={settings.ssWageGrowthRate}
            medicarePremiumInflationRate={settings.medicarePremiumInflationRate}
            medicarePremiumInflationEnabled={settings.medicarePremiumInflationEnabled}
          />
        )}
        {activeTab === "withdrawal" && withdrawalTab}
        {activeTab === "deductions" && (
          <DeductionsClient
            clientId={clientId}
            derivedRows={deductionsData.derivedRows}
            expenseDeductionRows={deductionsData.expenseDeductionRows}
            mortgageRows={deductionsData.mortgageRows}
            propertyTaxRows={deductionsData.propertyTaxRows}
            itemizedRows={deductionsData.itemizedRows}
            currentYear={deductionsData.currentYear}
            saltCap={deductionsData.saltCap}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
          />
        )}
        {activeTab === "tax-adjustments" && (
          <TaxAdjustmentsList
            clientId={clientId}
            rows={taxAdjustmentRows}
            currentYear={deductionsData.currentYear}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
          />
        )}
        {activeTab === "account-groups" && (
          <AccountGroupsTab
            clientId={clientId}
            liquidAccounts={liquidAccounts}
            allAccounts={allAccounts}
          />
        )}
      </div>
    </div>
  );
}
