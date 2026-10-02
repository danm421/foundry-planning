import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
  clientCmaOverrides,
  crmHouseholdContacts,
  clientRiskProfiles,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { buildModelPortfolioOptions } from "@/lib/cma/model-portfolio-options";
import type { AssumptionsClientProps } from "./assumptions-client";
import { treeMilestones, withdrawalRowsForDisplay } from "./scenario-milestones";
import { resolveInflationRate } from "@/lib/inflation";
import { amortizeLiability } from "@/engine/liabilities";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { storedInflationRate } from "@/lib/scenario/growth-settings-override";
import { planSettingsEngineToFormProps } from "@/lib/scenario/view-adapters";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";
import { getLatestTaxReturn } from "@/lib/tax-returns/store";
import { parseRowFacts } from "@/lib/tax-returns/db";

export type AssumptionsViewPropsResult =
  | { status: "ok"; props: AssumptionsClientProps }
  | { status: "no-base-case" }
  | { status: "no-plan-settings" };

/**
 * Everything `AssumptionsClient` renders from, for one client and scenario.
 * Shared by the Details page and the Solver's change editor so both work off
 * the same rows. Throws `notFound()` for an unknown client or a primary
 * contact without a date of birth.
 */
export async function loadAssumptionsViewProps(
  clientId: string,
  scenarioParam: string | undefined,
): Promise<AssumptionsViewPropsResult> {
  // The body below moved here verbatim from `AssumptionsContent`, which named it `id`.
  const id = clientId;
  const firmId = await getOrgId();

  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!clientRow) notFound();

  // CRM contacts — a primary contact with a date of birth is required.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  if (!primaryContact?.dateOfBirth) notFound();

  // One read for both: the base case (the plan settings below still key off it)
  // and the scenario being viewed, whose name titles the Solver's focus dialog.
  const scenarioRows = await db.select().from(scenarios).where(eq(scenarios.clientId, id));
  const scenario = scenarioRows.find((s) => s.isBaseCase);
  const scenarioName = scenarioRows.find((s) => s.id === scenarioParam)?.name;

  if (!scenario) {
    return { status: "no-base-case" };
  }

  const [
    settingsRows,
    portfolioRows,
    allocationRows,
    assetClassRows,
    riskProfileRows,
    { effectiveTree, resolutionContext, growthOverride },
  ] = await Promise.all([
    db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
    // Nothing in the risk-profile plan syncs `clients.risk_tolerance` from the
    // composite level, so the legacy column would go stale the moment an
    // advisor changes tolerance on /risk. Prefer the composite level; fall
    // back to the legacy column only when no profile row exists yet.
    db
      .select({ compositeLevel: clientRiskProfiles.compositeLevel })
      .from(clientRiskProfiles)
      .where(and(eq(clientRiskProfiles.clientId, id), eq(clientRiskProfiles.firmId, firmId))),
    loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
  ]);

  const riskLevel = riskProfileRows[0]?.compositeLevel ?? clientRow.riskTolerance;

  const accountRows = effectiveTree.accounts;
  const savingsRows = effectiveTree.savingsRules;
  const expenseRows = effectiveTree.expenses;
  const liabilityRows = effectiveTree.liabilities;
  // Deductions, tax adjustments and withdrawal order are overlaid scenario
  // rows: read them from the effective tree, not the base tables.
  const deductionRows = effectiveTree.deductions ?? [];
  const taxAdjustmentTreeRows = effectiveTree.taxAdjustments ?? [];

  // Derive per-account owner key ("client" | "spouse" | "joint") for UI display.
  const _clientFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const _spouseFmId = (effectiveTree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  function _ownerKeyOf(acct: (typeof accountRows)[number]): "client" | "spouse" | "joint" {
    const cfm = controllingFamilyMember(acct);
    if (cfm === _spouseFmId && _spouseFmId != null) return "spouse";
    if (cfm === _clientFmId && _clientFmId != null) return "client";
    return "joint";
  }

  const settings = settingsRows[0];
  if (!settings) {
    return { status: "no-plan-settings" };
  }

  // Auto-fill the long-term capital loss carryforward from the client's most
  // recently analyzed tax return when no value has been entered/saved yet.
  // getLatestTaxReturn is NOT itself firm-scoped, so it may only be called
  // after client access has already been authorized (the clientRow lookup
  // above). Best-effort — a missing/unreadable return must never break this
  // page; it just means no autofill hint is shown. Runs concurrently with the
  // firmInflationAc lookup below (independent queries).
  // In a scenario the stored value is the scenario's, read off the tree.
  const scenarioSettings = scenarioParam
    ? planSettingsEngineToFormProps(
        effectiveTree.planSettings,
        effectiveTree.client,
        storedInflationRate(String(settings.inflationRate), growthOverride ?? {}),
      )
    : null;
  const storedCapitalLossLt = scenarioSettings
    ? scenarioSettings.capitalLossCarryforwardLt
    : (settings.capitalLossCarryforwardLt ?? "");
  const needsCapitalLossAutofill = storedCapitalLossLt === "";

  const [taxReturnAutofill, [firmInflationAc]] = await Promise.all([
    needsCapitalLossAutofill
      ? (async () => {
          try {
            const latestTaxReturn = await getLatestTaxReturn(id);
            if (!latestTaxReturn) return null;
            const { facts } = parseRowFacts(latestTaxReturn);
            const carryover = facts?.carryovers.capitalLossCarryover;
            if (carryover == null) return null;
            return { default: String(carryover), sourceYear: latestTaxReturn.taxYear };
          } catch (err) {
            console.error(
              "AssumptionsContent: tax return read failed (best-effort, no autofill):",
              err,
            );
            return null;
          }
        })()
      : Promise.resolve(null),
    db
      .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
      .from(assetClasses)
      .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation"))),
  ]);

  let capitalLossCarryforwardLtDefault = storedCapitalLossLt;
  let capitalLossCarryforwardLtSourceYear: number | null = null;
  if (taxReturnAutofill) {
    capitalLossCarryforwardLtDefault = taxReturnAutofill.default;
    capitalLossCarryforwardLtSourceYear = taxReturnAutofill.sourceYear;
  }

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (settings.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(
        eq(clientCmaOverrides.clientId, id),
        eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
      ));
    if (override) clientInflationOverride = override;
  }

  // In a scenario the rate the projection runs on is the override load's, which
  // `resolutionContext` carries.
  const resolvedInflationRate =
    scenarioParam && resolutionContext
      ? resolutionContext.resolvedInflationRate
      : resolveInflationRate(
          { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate },
          firmInflationAc ?? null,
          clientInflationOverride,
        );

  // What the "Asset class" inflation option would resolve to regardless of the
  // current source — the radio row quotes it, and `resolvedInflationRate`
  // returns the *custom* rate whenever the source is custom.
  const assetClassInflationRate = resolveInflationRate(
    { inflationRateSource: "asset_class", inflationRate: null },
    firmInflationAc ?? null,
    clientInflationOverride,
  );

  const modelPortfolioOptions = buildModelPortfolioOptions(
    portfolioRows,
    allocationRows,
    assetClassRows,
  ).map((o) => ({
    ...o,
    riskLevel: portfolioRows.find((p) => p.id === o.id)?.riskLevel ?? null,
  }));

  // The scenario's milestones: a scenario that moves retirement moves every
  // milestone-anchored year the editors show and pre-fill.
  const milestones = treeMilestones(effectiveTree);

  // Resolution-on-read, display only: a read never writes.
  const withdrawalRows = withdrawalRowsForDisplay(effectiveTree.withdrawalStrategy, milestones);

  // ── Deductions-tab derived data ─────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const saltCap = currentYear >= 2026 ? 40_000 : 10_000;

  const derivedRows = savingsRows
    .filter((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId);
      if (!acct) return false;
      if (acct.subType !== "traditional_ira" && acct.subType !== "401k") return false;
      if (currentYear < r.startYear || currentYear > r.endYear) return false;
      return true;
    })
    .map((r) => {
      const acct = accountRows.find((a) => a.id === r.accountId)!;
      return {
        id: r.id,
        accountName: acct.name,
        subType: acct.subType ?? "",
        annualAmount: r.annualAmount,
        owner: _ownerKeyOf(acct),
        startYear: r.startYear,
        endYear: r.endYear,
      };
    });

  const expenseDeductionRows = expenseRows
    .filter((e) => e.deductionType != null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      deductionType: e.deductionType!,
      annualAmount: e.annualAmount,
    }));

  const mortgageRows = liabilityRows
    .filter((l) => l.isInterestDeductible)
    .map((l) => {
      const result = amortizeLiability(l, currentYear);
      return {
        id: l.id,
        name: l.name,
        estimatedInterest: result.interestPortion,
      };
    })
    .filter((r) => r.estimatedInterest > 0);

  const propertyTaxRows = accountRows
    .filter((a) => (a.annualPropertyTax ?? 0) > 0)
    .map((a) => {
      const baseTax = a.annualPropertyTax ?? 0;
      const growthRate = a.propertyTaxGrowthRate ?? 0;
      const currentYearInflated = baseTax * Math.pow(1 + growthRate, 0);
      return {
        id: a.id,
        name: a.name,
        annualPropertyTax: baseTax,
        currentYearInflated,
      };
    });

  const itemizedRows = deductionRows.map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name ?? null,
    owner: d.owner ?? "joint",
    annualAmount: d.annualAmount,
    growthRate: d.growthRate,
    startYear: d.startYear,
    endYear: d.endYear,
    startYearRef: d.startYearRef ?? null,
    endYearRef: d.endYearRef ?? null,
  }));

  const taxAdjustmentRows = taxAdjustmentTreeRows.map((a) => ({
    id: a.id,
    taxType: a.taxType,
    name: a.name,
    owner: a.owner ?? "joint",
    annualAmount: a.annualAmount,
    growthRate: a.growthRate,
    startYear: a.startYear,
    endYear: a.endYear,
    startYearRef: a.startYearRef ?? null,
    endYearRef: a.endYearRef ?? null,
    withheldMode: a.withheldMode,
    withheldValue: a.withheldValue,
  }));

  const liquidAccounts = accountRows
    .filter((a) => ["taxable", "cash", "retirement"].includes(a.category))
    .map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category as "taxable" | "cash" | "retirement",
      value: Number(a.value),
    }));

  const allAccounts = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category as import("@/components/account-groups/types").AssetCategory,
    value: Number(a.value),
  }));

  return {
    status: "ok",
    props: {
      clientId: id,
      scenarioName,
      riskLevel,
      filingStatus: clientRow.filingStatus,
      settings: scenarioSettings
        ? {
            ...scenarioSettings,
            capitalLossCarryforwardLt: capitalLossCarryforwardLtDefault,
            capitalLossCarryforwardLtSourceYear,
          }
        : {
        flatFederalRate: String(settings.flatFederalRate),
        flatStateRate: String(settings.flatStateRate),
        estateAdminExpenses: String(settings.estateAdminExpenses),
        flatStateEstateRate: String(settings.flatStateEstateRate),
        residenceState: (settings.residenceState ?? null) as import("@/lib/usps-states").USPSStateCode | null,
        irdTaxRate: String(settings.irdTaxRate),
        probateCostRate: String(settings.probateCostRate),
        pvDiscountRate: settings.pvDiscountRate != null ? String(settings.pvDiscountRate) : "",
        inflationRate: String(settings.inflationRate),
        inflationRateSource: settings.inflationRateSource,
        planStartYear: settings.planStartYear,
        planEndYear: settings.planEndYear,
        defaultGrowthTaxable: String(settings.defaultGrowthTaxable),
        defaultGrowthCash: String(settings.defaultGrowthCash),
        defaultGrowthRetirement: String(settings.defaultGrowthRetirement),
        defaultGrowthRealEstate: String(settings.defaultGrowthRealEstate),
        defaultGrowthBusiness: String(settings.defaultGrowthBusiness),
        defaultGrowthLifeInsurance: String(settings.defaultGrowthLifeInsurance),
        growthSourceTaxable: settings.growthSourceTaxable,
        growthSourceCash: settings.growthSourceCash,
        growthSourceRetirement: settings.growthSourceRetirement,
        growthSourceRealEstate: settings.growthSourceRealEstate,
        growthSourceBusiness: settings.growthSourceBusiness,
        growthSourceLifeInsurance: settings.growthSourceLifeInsurance,
        modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable,
        modelPortfolioIdCash: settings.modelPortfolioIdCash,
        modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement,
        taxEngineMode: settings.taxEngineMode,
        taxInflationRate: settings.taxInflationRate != null ? String(settings.taxInflationRate) : "",
        lifetimeExemptionCap: settings.lifetimeExemptionCap != null ? String(settings.lifetimeExemptionCap) : "",
        ssWageGrowthRate: settings.ssWageGrowthRate != null ? String(settings.ssWageGrowthRate) : "",
        medicarePremiumInflationRate: settings.medicarePremiumInflationRate != null ? String(settings.medicarePremiumInflationRate) : "0.03",
        medicarePremiumInflationEnabled: settings.medicarePremiumInflationEnabled,
        outOfHouseholdDniRate: String(settings.outOfHouseholdDniRate),
        priorTaxableGiftsClient: String(settings.priorTaxableGiftsClient),
        priorTaxableGiftsSpouse: String(settings.priorTaxableGiftsSpouse),
        capitalLossCarryforwardSt: settings.capitalLossCarryforwardSt ?? "",
        capitalLossCarryforwardLt: capitalLossCarryforwardLtDefault,
        capitalLossCarryforwardLtSourceYear,
        surplusSpendPct: String(settings.surplusSpendPct ?? "0"),
        surplusSaveAccountId: settings.surplusSaveAccountId,
        surplusSpendAllUntilRetirement: settings.surplusSpendAllUntilRetirement ?? false,
        coveredByWorkplacePlan: clientRow.coveredByWorkplacePlan,
        spouseCoveredByWorkplacePlan: clientRow.spouseCoveredByWorkplacePlan,
      },
      resolvedInflationRate,
      assetClassInflationRate,
      hasInflationAssetClass: firmInflationAc != null,
      modelPortfolios: modelPortfolioOptions,
      accounts: accountRows.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType,
        isDefaultChecking: a.isDefaultChecking,
        ownerEntityId: controllingEntity(a) ?? null,
      })),
      withdrawalStrategies: withdrawalRows,
      milestones,
      clientFirstName: effectiveTree.client.firstName,
      spouseFirstName: effectiveTree.client.spouseName?.split(" ")[0],
      liquidAccounts,
      allAccounts,
      deductionsData: {
        derivedRows,
        expenseDeductionRows,
        mortgageRows,
        propertyTaxRows,
        itemizedRows,
        currentYear,
        saltCap,
      },
      taxAdjustmentRows,
    },
  };
}
