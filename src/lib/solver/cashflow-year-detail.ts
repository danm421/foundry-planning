import type { ClientData, ProjectionYear } from "@/engine";
import { controllingFamilyMember } from "@/engine/ownership";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-chart";

export interface CashFlowLineItem {
  id: string;
  label: string;
  amount: number;
}

export interface CashFlowCategory {
  key: string;
  label: string;
  total: number;
  items: CashFlowLineItem[];
}

export interface CashFlowYearDetail {
  year: number;
  ageLabel: string;
  inflows: CashFlowCategory[];
  outflows: CashFlowCategory[];
  /** Portfolio drawdown funding a negative cash-flow year. Surfaced on its own
   *  because the engine's `totalIncome` (and therefore the reconciled inflow
   *  categories) excludes withdrawals — folding them into `inflows` would break
   *  the tie-out to Total Inflows and spawn a bogus balancing "Other" row. */
  withdrawals: CashFlowCategory | null;
  totals: { inflows: number; outflows: number; net: number; endingPortfolio: number };
}

// Synthetic income.bySource key prefixes that represent one-off / portfolio
// inflows rather than named recurring income rows. They surface under
// "Other Inflows", not "Income".
const OTHER_INFLOW_PREFIXES = [
  "technique-proceeds:",
  "life-insurance-proceeds:",
  "equity-proceeds:",
];

const EPSILON = 1; // sub-dollar reconciliation noise we don't surface

function sum(items: CashFlowLineItem[]): number {
  return items.reduce((s, i) => s + i.amount, 0);
}

/** Build id→name maps from the working client data (mirrors cashflow-report.tsx). */
export function buildNameMaps(clientData: ClientData) {
  const incomeNames: Record<string, string> = {};
  for (const inc of clientData.incomes ?? []) {
    if (inc.type === "business" && inc.ownerEntityId != null) continue;
    incomeNames[inc.id] = inc.name;
  }
  for (const entity of clientData.entities ?? []) {
    if (entity.entityType === "trust") continue;
    incomeNames[entity.id] = entity.name ?? entity.id;
  }

  const accountNames: Record<string, string> = {};
  for (const acc of clientData.accounts ?? []) accountNames[acc.id] = acc.name;

  const liabilityNames: Record<string, string> = {};
  for (const liab of clientData.liabilities ?? []) liabilityNames[liab.id] = liab.name;

  const expenseNames: Record<string, string> = {};
  for (const exp of clientData.expenses ?? []) expenseNames[exp.id] = exp.name;
  for (const acc of clientData.accounts ?? []) {
    if (acc.category === "real_estate" && (acc.annualPropertyTax ?? 0) > 0) {
      expenseNames[`synth-proptax-${acc.id}`] = `Property Tax – ${acc.name}`;
    }
  }
  expenseNames["medicarePremiums"] = "Medicare Premiums";

  const otherInflowNames: Record<string, string> = {};
  for (const txn of clientData.assetTransactions ?? []) {
    otherInflowNames[`technique-proceeds:${txn.id}`] = `Net Proceeds: ${txn.name}`;
  }
  for (const acc of clientData.accounts ?? []) {
    if (acc.category === "life_insurance") {
      otherInflowNames[`life-insurance-proceeds:${acc.id}`] = `Life Insurance: ${acc.name}`;
    }
  }
  for (const plan of clientData.stockOptionPlans ?? []) {
    otherInflowNames[`equity-proceeds:${plan.accountId}`] =
      `Equity Sale: ${plan.ticker ?? plan.accountId}`;
  }

  const expenseTypeById: Record<string, string> = {};
  for (const exp of clientData.expenses ?? []) expenseTypeById[exp.id] = exp.type;

  const noteNames: Record<string, string> = {};
  for (const note of clientData.notesReceivable ?? []) noteNames[note.id] = note.name;

  return { incomeNames, accountNames, liabilityNames, expenseNames, otherInflowNames, expenseTypeById, noteNames };
}

function isOtherInflowKey(key: string): boolean {
  return OTHER_INFLOW_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Category whose header total is the canonical aggregate field. When item
 * detail is partial (sums to less than `total`), append a balancing "Other"
 * item so item rows always sum to the header.
 */
function canonicalCategory(
  key: string,
  label: string,
  total: number,
  items: CashFlowLineItem[],
): CashFlowCategory {
  const nonZero = items.filter((i) => Math.abs(i.amount) >= EPSILON);
  const itemsSum = sum(nonZero);
  if (nonZero.length > 0 && Math.abs(total - itemsSum) >= EPSILON) {
    nonZero.push({ id: `${key}-other`, label: "Other", amount: total - itemsSum });
  }
  return { key, label, total, items: nonZero };
}

/** Category whose header total is the sum of its enumerated items. */
function summedCategory(key: string, label: string, items: CashFlowLineItem[]): CashFlowCategory {
  const nonZero = items.filter((i) => Math.abs(i.amount) >= EPSILON);
  return { key, label, total: sum(nonZero), items: nonZero };
}

export function buildCashFlowYearDetail(
  year: ProjectionYear,
  clientData: ClientData,
): CashFlowYearDetail {
  const m = buildNameMaps(clientData);

  // ── Inflows ───────────────────────────────────────────────────────────
  const incomeItems: CashFlowLineItem[] = Object.entries(year.income.bySource)
    .filter(([key]) => !isOtherInflowKey(key))
    .map(([id, amount]) => ({ id, label: m.incomeNames[id] ?? id, amount }));

  // Only household-owned RMDs flow into year.totalIncome — the engine routes an
  // entity-owned account's RMD to entity checking (grantor pass-through), not the
  // household. Mirror that here so the RMD category reconciles to totalIncome
  // instead of overshooting by every entity RMD.
  const accountsById = new Map((clientData.accounts ?? []).map((a) => [a.id, a]));
  const rmdItems: CashFlowLineItem[] = Object.entries(year.accountLedgers)
    .filter(([id, l]) => {
      if (l.rmdAmount <= 0) return false;
      const acc = accountsById.get(id);
      return acc != null && Array.isArray(acc.owners) && controllingFamilyMember(acc) != null;
    })
    .map(([id, l]) => ({ id, label: m.accountNames[id] ?? id, amount: l.rmdAmount }));

  const withdrawalItems: CashFlowLineItem[] = Object.entries(year.withdrawals.byAccount)
    .map(([id, amount]) => ({ id, label: m.accountNames[id] ?? id, amount }));

  const otherInflowItems: CashFlowLineItem[] = [
    ...Object.entries(year.income.bySource)
      .filter(([key]) => isOtherInflowKey(key))
      .map(([id, amount]) => ({ id, label: m.otherInflowNames[id] ?? id, amount })),
    ...Object.entries(year.notesReceivableByNote ?? {}).map(([id, n]) => ({
      id: `note:${id}`,
      label: m.noteNames[id] ? `Note: ${m.noteNames[id]}` : `Note ${id}`,
      amount: n.totalCashIn,
    })),
  ];

  const inflows: CashFlowCategory[] = [
    summedCategory("income", "Income", incomeItems),
    summedCategory("rmds", "RMDs", rmdItems),
    summedCategory("otherInflows", "Other Inflows", otherInflowItems),
  ].filter((c) => Math.abs(c.total) >= EPSILON);

  // Reconcile the income-derived categories against year.totalIncome (which
  // EXCLUDES withdrawals). Withdrawals are surfaced separately, below.
  const inflowResidual = year.totalIncome - inflows.reduce((s, c) => s + c.total, 0);
  if (Math.abs(inflowResidual) >= EPSILON) {
    inflows.push({ key: "residual", label: "Other", total: inflowResidual, items: [] });
  }

  const withdrawalCategory = summedCategory("withdrawals", "Portfolio Withdrawals", withdrawalItems);
  const withdrawals =
    Math.abs(withdrawalCategory.total) >= EPSILON ? withdrawalCategory : null;

  // ── Outflows ──────────────────────────────────────────────────────────
  const livingItems = Object.entries(year.expenses.bySource)
    .filter(([id]) => m.expenseTypeById[id] === "living")
    .map(([id, amount]) => ({ id, label: m.expenseNames[id] ?? id, amount }));

  const liabilityItems = Object.entries(year.expenses.byLiability)
    .map(([id, amount]) => ({ id, label: m.liabilityNames[id] ?? id, amount }));

  const otherExpenseItems = Object.entries(year.expenses.bySource)
    .filter(([id]) => m.expenseTypeById[id] === "other")
    .map(([id, amount]) => ({ id, label: m.expenseNames[id] ?? id, amount }));

  const insuranceItems = Object.entries(year.expenses.bySource)
    .filter(([id]) => m.expenseTypeById[id] === "insurance" || id === "medicarePremiums")
    .map(([id, amount]) => ({ id, label: m.expenseNames[id] ?? id, amount }));

  const realEstateItems = Object.entries(year.expenses.bySource)
    .filter(([id]) => id.startsWith("synth-proptax-"))
    .map(([id, amount]) => ({ id, label: m.expenseNames[id] ?? id, amount }));

  const taxItems: CashFlowLineItem[] = year.taxResult
    ? [
        { id: "tax-federal", label: "Federal", amount: year.taxResult.flow.totalFederalTax ?? 0 },
        { id: "tax-state", label: "State", amount: year.taxResult.flow.stateTax ?? 0 },
      ].filter((i) => Math.abs(i.amount) >= EPSILON)
    : [];

  const savingsItems = Object.entries(year.savings.byAccount)
    .map(([id, amount]) => ({ id, label: m.accountNames[id] ?? id, amount }));

  const outflows: CashFlowCategory[] = [
    canonicalCategory("living", "Living Expenses", year.expenses.living, livingItems.length > 1 ? livingItems : []),
    summedCategory("liabilities", "Liabilities", liabilityItems),
    canonicalCategory("other", "Other Expenses", year.expenses.other, otherExpenseItems),
    canonicalCategory("insurance", "Insurance Premiums", year.expenses.insurance, insuranceItems),
    canonicalCategory("realEstate", "Real Estate", year.expenses.realEstate, realEstateItems),
    canonicalCategory("taxes", "Taxes", year.expenses.taxes, taxItems),
    summedCategory("savings", "Savings", savingsItems),
  ].filter((c) => Math.abs(c.total) >= EPSILON);

  const outflowResidual = year.totalExpenses - outflows.reduce((s, c) => s + c.total, 0);
  if (Math.abs(outflowResidual) >= EPSILON) {
    outflows.push({ key: "residual", label: "Other", total: outflowResidual, items: [] });
  }

  // ── Header + totals ───────────────────────────────────────────────────
  const ageLabel =
    year.ages.spouse != null
      ? `Age ${year.ages.client} / ${year.ages.spouse}`
      : `Age ${year.ages.client}`;

  return {
    year: year.year,
    ageLabel,
    inflows,
    outflows,
    withdrawals,
    totals: {
      inflows: year.totalIncome,
      outflows: year.totalExpenses,
      net: year.netCashFlow,
      endingPortfolio: liquidPortfolioTotal(year),
    },
  };
}
