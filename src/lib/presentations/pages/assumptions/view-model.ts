// Pure ClientData + InvestmentsBundle -> AssumptionsPageData transformation.
// Framework-free. Tax/inflation/horizon/withdrawal come from planSettings (scenario-
// effective); account/CMA sections come from the base-case investments bundle.

import type { PlanSettings, WithdrawalPriority } from "@/engine/types";
import type { InvestmentsBundle, CategoryGrowthDefault } from "@/lib/presentations/investments-bundle";
import { exactCurrency } from "@/lib/presentations/format";
import {
  formatPct,
  blendReturn,
  growthSourceLabel,
  accountCategoryLabel,
  CATEGORY_GROWTH_ORDER,
} from "./helpers";
import type {
  AssumptionRow,
  AssumptionsSection,
  AssumptionsPageData,
  BuildAssumptionsInput,
  CategoryGrowthRow,
  AccountGrowthRow,
  ReferencedPortfolio,
  CmaRow,
} from "./types";

export function buildAssumptionsData(input: BuildAssumptionsInput): AssumptionsPageData {
  const { clientData, years, investments, scenarioLabel, options } = input;
  const ps = clientData.planSettings;

  const geoByClassId = new Map<string, number>();
  const classNameById = new Map<string, string>();
  const classSortById = new Map<string, number>();
  const portfolioNameById = new Map<string, string>();
  if (investments) {
    for (const c of investments.assetClassData) geoByClassId.set(c.id, c.geometricReturn);
    for (const c of investments.assetClassLites) {
      classNameById.set(c.id, c.name);
      classSortById.set(c.id, c.sortOrder);
    }
    for (const p of investments.portfolioLites) portfolioNameById.set(p.id, p.name);
  }

  const overviewSections = buildOverview(ps, years);
  const categoryGrowth = investments
    ? buildCategoryGrowth(investments, ps.inflationRate, geoByClassId, portfolioNameById)
    : [];
  const withdrawalOrder = buildWithdrawalOrder(clientData.withdrawalStrategy, clientData.accounts);
  const stressTests = buildStressTests(ps);

  const accounts = options.includeAccountTable
    ? buildAccounts(clientData.accounts, investments, portfolioNameById, options.showAccountValues)
    : null;

  const appendixOn = options.includeCmaAppendix && investments != null;
  const referencedPortfolios = appendixOn
    ? buildReferencedPortfolios(investments!, geoByClassId, classNameById, classSortById)
    : null;
  const cma = appendixOn ? buildCma(investments!, classSortById) : null;

  return {
    title: "Planning Assumptions",
    subtitle: scenarioLabel,
    overviewSections,
    categoryGrowth,
    withdrawalOrder,
    stressTests,
    accounts,
    referencedPortfolios,
    cma,
    showBaseCaseFootnote: (accounts != null && accounts.length > 0) || appendixOn,
  };
}

function buildOverview(ps: PlanSettings, years: BuildAssumptionsInput["years"]): AssumptionsSection[] {
  const sections: AssumptionsSection[] = [];
  const first = years[0];
  const last = years[years.length - 1];

  // Plan Horizon
  const horizon: AssumptionRow[] = [
    { label: "Plan start", value: String(ps.planStartYear) },
    { label: "Plan end", value: String(ps.planEndYear) },
    { label: "Length", value: `${ps.planEndYear - ps.planStartYear + 1} years` },
  ];
  if (first && last) {
    horizon.push({ label: "Client age", value: `${first.ages.client} → ${last.ages.client}` });
    if (first.ages.spouse != null && last.ages.spouse != null) {
      horizon.push({ label: "Spouse age", value: `${first.ages.spouse} → ${last.ages.spouse}` });
    }
  }
  sections.push({ heading: "Plan Horizon", rows: horizon });

  // Income Tax
  const incomeTax: AssumptionRow[] = [
    { label: "Method", value: ps.taxEngineMode === "bracket" ? "Bracket-based" : "Flat rate" },
  ];
  if (ps.taxEngineMode !== "bracket") {
    incomeTax.push({ label: "Federal rate", value: formatPct(ps.flatFederalRate) });
    incomeTax.push({ label: "State rate", value: formatPct(ps.flatStateRate) });
  }
  if (ps.residenceState) incomeTax.push({ label: "State of residence", value: ps.residenceState });
  sections.push({ heading: "Income Tax", rows: incomeTax });

  // Estate Tax — every row conditional; omit the section if empty
  const estate: AssumptionRow[] = [];
  if (ps.residenceState) estate.push({ label: "State of residence", value: ps.residenceState });
  if (ps.estateAdminExpenses) estate.push({ label: "Admin expenses", value: exactCurrency(ps.estateAdminExpenses) });
  if (ps.probateCostRate) estate.push({ label: "Probate cost", value: formatPct(ps.probateCostRate) });
  if (ps.irdTaxRate) estate.push({ label: "IRD tax rate", value: formatPct(ps.irdTaxRate) });
  if (ps.outOfHouseholdRate) estate.push({ label: "Out-of-household rate", value: formatPct(ps.outOfHouseholdRate) });
  if (ps.pvDiscountRate) estate.push({ label: "PV discount rate", value: formatPct(ps.pvDiscountRate) });
  if (ps.lifetimeExemptionCap != null) estate.push({ label: "Exemption cap", value: exactCurrency(ps.lifetimeExemptionCap) });
  if (ps.priorTaxableGifts?.client) estate.push({ label: "Prior gifts (client)", value: exactCurrency(ps.priorTaxableGifts.client) });
  if (ps.priorTaxableGifts?.spouse) estate.push({ label: "Prior gifts (spouse)", value: exactCurrency(ps.priorTaxableGifts.spouse) });
  if (estate.length > 0) sections.push({ heading: "Estate Tax", rows: estate });

  // Inflation
  const inflation: AssumptionRow[] = [{ label: "General inflation", value: formatPct(ps.inflationRate) }];
  if (ps.ssWageGrowthRate != null) inflation.push({ label: "SS wage growth", value: formatPct(ps.ssWageGrowthRate) });
  if (ps.taxInflationRate != null) inflation.push({ label: "Tax bracket inflation", value: formatPct(ps.taxInflationRate) });
  if (ps.livingExpenseInflationOverride != null) inflation.push({ label: "Living-expense override", value: formatPct(ps.livingExpenseInflationOverride) });
  sections.push({ heading: "Inflation", rows: inflation });

  return sections;
}

function categoryRate(
  def: CategoryGrowthDefault,
  inflationRate: number,
  geoByClassId: Map<string, number>,
  portfolioAllocationsByPortfolioId: Record<string, { assetClassId: string; weight: number }[]>,
): string {
  if (def.source === "model_portfolio" && def.modelPortfolioId) {
    const alloc = portfolioAllocationsByPortfolioId[def.modelPortfolioId];
    if (alloc) return formatPct(blendReturn(alloc, geoByClassId));
    return "—";
  }
  if (def.source === "inflation") return formatPct(inflationRate);
  if (def.source === "custom") return formatPct(def.customRate);
  return "—";
}

function categorySourceLabel(def: CategoryGrowthDefault, portfolioNameById: Map<string, string>): string {
  if (def.source === "model_portfolio") return `Model: ${def.modelPortfolioId ? portfolioNameById.get(def.modelPortfolioId) ?? "—" : "—"}`;
  if (def.source === "inflation") return "Inflation";
  if (def.source === "custom") return "Custom";
  if (def.source === "asset_mix") return "Asset mix";
  return "Plan default";
}

function buildCategoryGrowth(
  bundle: InvestmentsBundle,
  inflationRate: number,
  geoByClassId: Map<string, number>,
  portfolioNameById: Map<string, string>,
): CategoryGrowthRow[] {
  const defaults = bundle.planGrowthDefaults;
  if (!defaults) return [];
  return CATEGORY_GROWTH_ORDER.map(({ key, label }) => {
    const def = defaults[key];
    return {
      category: label,
      source: categorySourceLabel(def, portfolioNameById),
      rate: categoryRate(def, inflationRate, geoByClassId, bundle.modelPortfolioAllocationsByPortfolioId),
    };
  });
}

function buildWithdrawalOrder(
  strategy: WithdrawalPriority[],
  accounts: { id: string; name: string }[],
): string[] {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  // Distinct accounts, ordered by their minimum priorityOrder across year windows.
  const minPriority = new Map<string, number>();
  for (const w of strategy) {
    const prev = minPriority.get(w.accountId);
    if (prev == null || w.priorityOrder < prev) minPriority.set(w.accountId, w.priorityOrder);
  }
  return [...minPriority.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => nameById.get(id))
    .filter((n): n is string => n != null);
}

function buildStressTests(ps: PlanSettings): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  if (ps.ssBenefitHaircut) rows.push({ label: "SS benefit haircut", value: `${formatPct(ps.ssBenefitHaircut.pct)} from ${ps.ssBenefitHaircut.startYear}` });
  if (ps.disabilityEvent) rows.push({ label: "Disability", value: `${ps.disabilityEvent.person} earned income stops ${ps.disabilityEvent.startYear}` });
  if (ps.marketShock) rows.push({ label: "Market shock", value: `${formatPct(ps.marketShock.drawdownPct)} drawdown in ${ps.marketShock.year}` });
  return rows;
}

function buildAccounts(
  accounts: { id: string; name: string; category: import("@/engine/types").Account["category"]; growthRate: number; value: number }[],
  bundle: InvestmentsBundle | undefined,
  portfolioNameById: Map<string, string>,
  showValues: boolean,
): AccountGrowthRow[] {
  const sourceById = new Map<string, string>();
  if (bundle) for (const a of bundle.accounts) sourceById.set(a.id, growthSourceLabel(a, portfolioNameById));
  return accounts
    .map((a) => ({
      name: a.name,
      category: accountCategoryLabel(a.category),
      value: showValues ? a.value : null,
      rate: formatPct(a.growthRate),
      source: sourceById.get(a.id) ?? "—",
    }))
    .sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
}

function buildReferencedPortfolios(
  bundle: InvestmentsBundle,
  geoByClassId: Map<string, number>,
  classNameById: Map<string, string>,
  classSortById: Map<string, number>,
): ReferencedPortfolio[] {
  const ids = new Set<string>();
  for (const a of bundle.accounts) if (a.growthSource === "model_portfolio" && a.modelPortfolioId) ids.add(a.modelPortfolioId);
  const defaults = bundle.planGrowthDefaults;
  if (defaults) {
    for (const key of ["taxable", "cash", "retirement"] as const) {
      const def = defaults[key];
      if (def.source === "model_portfolio" && def.modelPortfolioId) ids.add(def.modelPortfolioId);
    }
  }
  return [...ids]
    .map((id): ReferencedPortfolio => {
      const alloc = bundle.modelPortfolioAllocationsByPortfolioId[id] ?? [];
      const rows = alloc
        .slice()
        .sort((a, b) => (classSortById.get(a.assetClassId) ?? 0) - (classSortById.get(b.assetClassId) ?? 0))
        .map((w) => ({
          assetClass: classNameById.get(w.assetClassId) ?? w.assetClassId,
          weight: formatPct(w.weight),
          classReturn: formatPct(geoByClassId.get(w.assetClassId) ?? Number.NaN),
        }));
      return {
        name: bundle.portfolioLites.find((p) => p.id === id)?.name ?? "—",
        blendedReturn: formatPct(blendReturn(alloc, geoByClassId)),
        rows,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildCma(bundle: InvestmentsBundle, classSortById: Map<string, number>): CmaRow[] {
  const nameById = new Map(bundle.assetClassLites.map((c) => [c.id, c.name]));
  return bundle.assetClassData
    .slice()
    .sort((a, b) => (classSortById.get(a.id) ?? 0) - (classSortById.get(b.id) ?? 0))
    .map((c) => ({
      assetClass: nameById.get(c.id) ?? c.id,
      expectedReturn: formatPct(c.geometricReturn),
      volatility: formatPct(c.volatility),
    }));
}
