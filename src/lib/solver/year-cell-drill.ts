// Pure per-column breakdowns for the solver year table's cell drill-downs.
// Total-first: each drill's header total is computed from the same expression
// the column renders, so the modal can never disagree with the cell; a
// balancing "Other" row absorbs any gap between enumerated items and that
// total (mirrors canonicalCategory in cashflow-year-detail.ts).
import type { ClientData, Income, ProjectionYear } from "@/engine";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import type { CellDrillGroup, CellDrillProps, CellDrillRow } from "@/lib/cell-drill/types";
import {
  ageLabel,
  buildNameMaps,
  householdRmdItems,
  livingExpenseItems,
  noteReceivableItems,
  otherOutflowItems,
  taxLineItems,
} from "./cashflow-year-detail";
import { yearCashFlow } from "./year-table-cash-flow";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

export type YearDrillColumnKey =
  | "socialSecurity"
  | "salaries"
  | "otherIncome"
  | "rmds"
  | "withdrawals"
  | "totalIn"
  | "livingExpenses"
  | "taxes"
  | "otherExpenses"
  | "savings"
  | "totalOut"
  | "net"
  | "portfolioAssets";

const EPSILON = 1; // sub-dollar reconciliation noise we don't surface

type NameMaps = ReturnType<typeof buildNameMaps>;

// The year table calls a drill fn for every cell on every render (11 money
// columns x 30-60 rows, no virtualization), so name maps are cached per
// ClientData reference to avoid rebuilding them hundreds of times per render.
const nameMapsCache = new WeakMap<ClientData, NameMaps>();

function cachedNameMaps(clientData: ClientData): NameMaps {
  let m = nameMapsCache.get(clientData);
  if (!m) {
    m = buildNameMaps(clientData);
    nameMapsCache.set(clientData, m);
  }
  return m;
}

// Drill results are pure in (columnKey, year, clientData), and both refs are
// stable across renders (a new projection run allocates new ProjectionYear
// objects), so each cell's breakdown is built once instead of on every table
// render — including the re-render that opening the modal itself triggers.
const drillCache = new WeakMap<
  ClientData,
  WeakMap<ProjectionYear, Map<YearDrillColumnKey, CellDrillProps | null>>
>();

/** Drop sub-dollar rows, sort descending, and append a balancing "Other" row
 *  when the survivors don't sum to `total`. */
function balanced(key: string, total: number, rows: CellDrillRow[]): CellDrillRow[] {
  const nonZero = rows
    .filter((r) => Math.abs(r.amount) >= EPSILON)
    .sort((a, b) => b.amount - a.amount);
  const sum = nonZero.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(total - sum) >= EPSILON) {
    nonZero.push({ id: `${key}-other`, label: "Other", amount: total - sum });
  }
  return nonZero;
}

function drillResult(
  key: string,
  title: string,
  year: ProjectionYear,
  total: number,
  rows: CellDrillRow[],
  opts?: { totalLabel?: string; footnote?: string; skipBalance?: boolean },
): CellDrillProps | null {
  const finalRows = opts?.skipBalance
    ? rows.filter((r) => Math.abs(r.amount) >= EPSILON)
    : balanced(key, total, rows);
  if (Math.abs(total) < EPSILON && finalRows.length === 0) return null;
  return {
    title: `${title} — ${year.year}`,
    subtitle: ageLabel(year),
    total,
    totalLabel: opts?.totalLabel,
    groups: [{ rows: finalRows }],
    footnote: opts?.footnote,
  };
}

function incomeRowsByTypes(
  year: ProjectionYear,
  m: NameMaps,
  types: ReadonlySet<Income["type"]>,
): CellDrillRow[] {
  return Object.entries(year.income.bySource)
    .filter(([id]) => {
      const t = m.incomeTypeById[id];
      return t != null && types.has(t);
    })
    .map(([id, amount]) => ({ id, label: m.incomeNames[id] ?? id, amount }));
}

export function buildYearCellDrill(
  columnKey: YearDrillColumnKey,
  year: ProjectionYear,
  clientData: ClientData,
): CellDrillProps | null {
  let byYear = drillCache.get(clientData);
  if (!byYear) drillCache.set(clientData, (byYear = new WeakMap()));
  let byKey = byYear.get(year);
  if (!byKey) byYear.set(year, (byKey = new Map()));
  const cached = byKey.get(columnKey);
  if (cached !== undefined) return cached;
  const result = computeYearCellDrill(columnKey, year, clientData);
  byKey.set(columnKey, result);
  return result;
}

function computeYearCellDrill(
  columnKey: YearDrillColumnKey,
  year: ProjectionYear,
  clientData: ClientData,
): CellDrillProps | null {
  const m = cachedNameMaps(clientData);
  const cf = yearCashFlow(year, clientData);

  switch (columnKey) {
    case "socialSecurity": {
      const d = year.socialSecurityDetail;
      let rows: CellDrillRow[];
      if (d) {
        const clientName = (clientData.client.firstName ?? "").trim() || "Client";
        const spouseName = (clientData.client.spouseName ?? "").trim() || CO_CLIENT_LABEL;
        const person = (
          name: string,
          keyPrefix: string,
          p: { retirement: number; spousal: number; survivor: number },
        ): CellDrillRow[] => [
          { id: `${keyPrefix}-retirement`, label: `${name} — Retirement`, amount: p.retirement },
          { id: `${keyPrefix}-spousal`, label: `${name} — Spousal`, amount: p.spousal },
          { id: `${keyPrefix}-survivor`, label: `${name} — Survivor`, amount: p.survivor },
        ];
        rows = [
          ...person(clientName, "client", d.client),
          ...(d.spouse ? person(spouseName, "spouse", d.spouse) : []),
        ];
      } else {
        rows = incomeRowsByTypes(year, m, new Set(["social_security"]));
      }
      return drillResult("socialSecurity", "Social Security", year, cf.socialSecurity, rows);
    }

    case "salaries":
      return drillResult(
        "salaries",
        "Salaries",
        year,
        cf.salaries,
        incomeRowsByTypes(year, m, new Set(["salary"])),
      );

    case "otherIncome": {
      // Everything in bySource that isn't a salary or SS row — named incomes
      // (business/trust/deferred/cap-gains/other), entity pass-throughs, and
      // synthetic proceeds keys (equity net cash included: totalIncome counts
      // it outside income.other) — plus notes-receivable cash.
      const excluded: ReadonlySet<Income["type"]> = new Set(["salary", "social_security"]);
      const sourceRows: CellDrillRow[] = Object.entries(year.income.bySource)
        .filter(([id]) => {
          const t = m.incomeTypeById[id];
          return t == null || !excluded.has(t);
        })
        .map(([id, amount]) => ({
          id,
          label: m.incomeNames[id] ?? m.otherInflowNames[id] ?? id,
          amount,
        }));
      return drillResult("otherIncome", "Other Income", year, cf.otherIncome, [
        ...sourceRows,
        ...noteReceivableItems(year, m),
      ]);
    }

    case "rmds":
      return drillResult(
        "rmds",
        "RMDs",
        year,
        cf.rmds,
        householdRmdItems(year, clientData, m.accountNames),
      );

    case "withdrawals": {
      const rows: CellDrillRow[] = Object.entries(year.withdrawals.byAccount).map(
        ([id, amount]) => ({ id, label: m.accountNames[id] ?? id, amount }),
      );
      return drillResult("withdrawals", "Withdrawals", year, year.withdrawals.total, rows);
    }

    case "totalIn":
      return drillResult(
        "totalIn",
        "Total In",
        year,
        cf.totalIn,
        [
          { id: "socialSecurity", label: "Social Security", amount: cf.socialSecurity },
          { id: "salaries", label: "Salaries", amount: cf.salaries },
          { id: "otherIncome", label: "Other Income", amount: cf.otherIncome },
          { id: "rmds", label: "RMDs", amount: cf.rmds },
          { id: "withdrawals", label: "Withdrawals", amount: cf.withdrawals },
        ],
        // Ties by construction; skip the sort so rows read in column order.
        { skipBalance: true },
      );

    case "livingExpenses":
      return drillResult(
        "livingExpenses",
        "Living Expenses",
        year,
        year.expenses.living,
        livingExpenseItems(year, m),
      );

    case "taxes":
      return drillResult("taxes", "Taxes", year, year.expenses.taxes, taxLineItems(year));

    case "otherExpenses": {
      const e = year.expenses;
      const items = otherOutflowItems(year, m);
      // cashGifts is already inside expenses.other, so it is not its own group.
      const groups: CellDrillGroup[] = [
        { label: "Debt Payments", rows: balanced("liabilities", e.liabilities, items.liabilities) },
        { label: "Insurance Premiums", rows: balanced("insurance", e.insurance, items.insurance) },
        { label: "Real Estate", rows: balanced("realEstate", e.realEstate, items.realEstate) },
        { label: "Other", rows: balanced("other", e.other, items.other) },
        {
          label: "Surplus Spent",
          rows: balanced("discretionary", e.discretionary, [
            { id: "discretionary", label: "Surplus Spent", amount: e.discretionary },
          ]),
        },
      ].filter((g) => g.rows.length > 0);
      // Anything expenses.total holds beyond these categories.
      const gap = cf.otherExpenses - groups.flatMap((g) => g.rows).reduce((s, r) => s + r.amount, 0);
      if (Math.abs(gap) >= EPSILON) {
        groups.push({ rows: [{ id: "otherExpenses-other", label: "Other", amount: gap }] });
      }
      if (Math.abs(cf.otherExpenses) < EPSILON && groups.length === 0) return null;
      return {
        title: `Other Expenses — ${year.year}`,
        subtitle: ageLabel(year),
        total: cf.otherExpenses,
        groups,
      };
    }

    case "savings":
      return drillResult("savings", "Savings", year, cf.savings, [
        ...Object.entries(year.savings.byAccount).map(([id, amount]) => ({
          id,
          label: m.accountNames[id] ?? id,
          amount,
        })),
        {
          id: "hypoContribution",
          label: "Hypothetical Savings",
          amount: year.hypotheticalSavings?.contribution ?? 0,
        },
      ]);

    case "totalOut":
      return drillResult(
        "totalOut",
        "Total Out",
        year,
        cf.totalOut,
        [
          { id: "living", label: "Living Expenses", amount: cf.living },
          { id: "taxes", label: "Taxes", amount: cf.taxes },
          { id: "otherExpenses", label: "Other Expenses", amount: cf.otherExpenses },
          { id: "savings", label: "Savings", amount: cf.savings },
        ],
        { skipBalance: true },
      );

    case "net": {
      // Drillable exactly when the cell prints a non-zero amount.
      if (Math.round(cf.net) === 0) return null;
      const surplus = cf.net > 0;
      const label = surplus ? "Surplus" : "Shortfall";
      return drillResult(
        "net",
        label,
        year,
        Math.abs(cf.net),
        surplus
          ? [
              { id: "in", label: "Total In", amount: cf.totalIn },
              { id: "out", label: "Less: Total Out", amount: -cf.totalOut },
            ]
          : [
              { id: "out", label: "Total Out", amount: cf.totalOut },
              { id: "in", label: "Less: Total In", amount: -cf.totalIn },
            ],
        {
          totalLabel: label,
          skipBalance: true,
          footnote: surplus
            ? "Left over after spending and savings. It stays in the portfolio."
            : "Spending that income, RMDs, and portfolio withdrawals could not cover.",
        },
      );
    }

    case "portfolioAssets": {
      const pa = year.portfolioAssets;
      // `map`/`groupTotal` are optional: a projection payload serialized before
      // a bucket existed still has to render rather than throw on
      // Object.entries(undefined).
      const group = (
        label: string,
        map: Record<string, number> | undefined,
        groupTotal: number | undefined,
        key: string,
      ): CellDrillGroup => ({
        label,
        rows: balanced(
          key,
          groupTotal ?? 0,
          Object.entries(map ?? {}).map(([id, amount]) => ({
            id,
            label: m.accountNames[id] ?? id,
            amount,
          })),
        ),
      });
      const groups = [
        group("Taxable", pa.taxable, pa.taxableTotal, "pa-taxable"),
        group("Cash", pa.cash, pa.cashTotal, "pa-cash"),
        group("Retirement", pa.retirement, pa.retirementTotal, "pa-retirement"),
        group("Annuity", pa.annuity, pa.annuityTotal, "pa-annuity"),
      ].filter((g) => g.rows.length > 0);
      const total = liquidPortfolioTotal(year);
      if (Math.abs(total) < EPSILON && groups.length === 0) return null;
      return {
        title: `Total Portfolio Assets — ${year.year}`,
        subtitle: ageLabel(year),
        total,
        groups,
        footnote:
          "End-of-year balances. Excludes real estate, business interests, life insurance, and locked trust assets.",
      };
    }
  }
}
