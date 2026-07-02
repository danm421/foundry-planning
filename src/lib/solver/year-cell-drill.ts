// Pure per-column breakdowns for the solver year table's cell drill-downs.
// Total-first: each drill's header total is computed from the same expression
// the column renders, so the modal can never disagree with the cell; a
// balancing "Other" row absorbs any gap between enumerated items and that
// total (mirrors canonicalCategory in cashflow-year-detail.ts).
import type { ClientData, Income, ProjectionYear } from "@/engine";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import type { CellDrillGroup, CellDrillProps, CellDrillRow } from "@/lib/cell-drill/types";
import { retirementInflows, rmdTotal } from "@/lib/retirement/retirement-inflows";
import { buildNameMaps } from "./cashflow-year-detail";

export type YearDrillColumnKey =
  | "socialSecurity"
  | "salaries"
  | "otherIncome"
  | "rmds"
  | "withdrawals"
  | "totalIncomeWithdrawals"
  | "livingExpenses"
  | "taxes"
  | "totalExpenses"
  | "shortfall"
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

function ageSubtitle(year: ProjectionYear): string {
  return year.ages.spouse != null
    ? `Age ${year.ages.client} / ${year.ages.spouse}`
    : `Age ${year.ages.client}`;
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
    subtitle: ageSubtitle(year),
    total,
    totalLabel: opts?.totalLabel,
    groups: [{ rows: finalRows }],
    footnote: opts?.footnote,
  };
}

function incomeRowsByTypes(
  year: ProjectionYear,
  clientData: ClientData,
  m: NameMaps,
  types: ReadonlySet<Income["type"]>,
): CellDrillRow[] {
  const typeById = new Map((clientData.incomes ?? []).map((i) => [i.id, i.type]));
  return Object.entries(year.income.bySource)
    .filter(([id]) => {
      const t = typeById.get(id);
      return t != null && types.has(t);
    })
    .map(([id, amount]) => ({ id, label: m.incomeNames[id] ?? id, amount }));
}

export function buildYearCellDrill(
  columnKey: YearDrillColumnKey,
  year: ProjectionYear,
  clientData: ClientData,
): CellDrillProps | null {
  const m = cachedNameMaps(clientData);
  const inflows = retirementInflows(year);

  switch (columnKey) {
    case "socialSecurity": {
      const d = year.socialSecurityDetail;
      let rows: CellDrillRow[];
      if (d) {
        const clientName = (clientData.client.firstName ?? "").trim() || "Client";
        const spouseName = (clientData.client.spouseName ?? "").trim() || "Spouse";
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
        rows = incomeRowsByTypes(year, clientData, m, new Set(["social_security"]));
      }
      return drillResult("socialSecurity", "Social Security", year, inflows.socialSecurity, rows);
    }

    case "salaries":
      return drillResult(
        "salaries",
        "Salaries",
        year,
        inflows.salaries,
        incomeRowsByTypes(year, clientData, m, new Set(["salary"])),
      );

    case "otherIncome": {
      // Everything in bySource that isn't a salary or SS row — named incomes
      // (business/trust/deferred/cap-gains/other), entity pass-throughs, and
      // synthetic proceeds keys — plus notes-receivable cash, mirroring
      // otherInflows() in retirement-inflows.ts.
      const typeById = new Map((clientData.incomes ?? []).map((i) => [i.id, i.type]));
      const excluded: ReadonlySet<Income["type"]> = new Set(["salary", "social_security"]);
      const sourceRows: CellDrillRow[] = Object.entries(year.income.bySource)
        .filter(([id]) => {
          const t = typeById.get(id);
          return t == null || !excluded.has(t);
        })
        .map(([id, amount]) => ({
          id,
          label: m.incomeNames[id] ?? m.otherInflowNames[id] ?? id,
          amount,
        }));
      const noteRows: CellDrillRow[] = Object.entries(year.notesReceivableByNote ?? {}).map(
        ([id, n]) => ({
          id: `note:${id}`,
          label: m.noteNames[id] ? `Note: ${m.noteNames[id]}` : `Note ${id}`,
          amount: n.totalCashIn,
        }),
      );
      return drillResult("otherIncome", "Other Income", year, inflows.otherInflows, [
        ...sourceRows,
        ...noteRows,
      ]);
    }

    case "rmds": {
      // ALL ledgers, including entity-owned — the column renders rmdTotal(),
      // which does not household-filter (unlike the cash-flow year panel).
      const rows: CellDrillRow[] = Object.entries(year.accountLedgers)
        .filter(([, l]) => l.rmdAmount > 0)
        .map(([id, l]) => ({ id, label: m.accountNames[id] ?? id, amount: l.rmdAmount }));
      return drillResult("rmds", "RMDs", year, rmdTotal(year), rows);
    }

    case "withdrawals": {
      const rows: CellDrillRow[] = Object.entries(year.withdrawals.byAccount).map(
        ([id, amount]) => ({ id, label: m.accountNames[id] ?? id, amount }),
      );
      return drillResult("withdrawals", "Withdrawals", year, year.withdrawals.total, rows);
    }

    case "totalIncomeWithdrawals": {
      const rows: CellDrillRow[] = [
        { id: "socialSecurity", label: "Social Security", amount: inflows.socialSecurity },
        { id: "salaries", label: "Salaries", amount: inflows.salaries },
        { id: "otherIncome", label: "Other Income", amount: inflows.otherInflows },
        { id: "rmds", label: "RMDs", amount: inflows.rmds },
        { id: "withdrawals", label: "Portfolio Withdrawals", amount: inflows.withdrawals },
      ];
      return drillResult(
        "totalIncomeWithdrawals",
        "Total Income & Withdrawals",
        year,
        inflows.total,
        rows,
        { skipBalance: true },
      );
    }

    case "livingExpenses": {
      const rows: CellDrillRow[] = Object.entries(year.expenses.bySource)
        .filter(([id]) => m.expenseTypeById[id] === "living")
        .map(([id, amount]) => ({ id, label: m.expenseNames[id] ?? id, amount }));
      return drillResult("livingExpenses", "Living Expenses", year, year.expenses.living, rows);
    }

    case "taxes": {
      const rows: CellDrillRow[] = year.taxResult
        ? [
            { id: "tax-federal", label: "Federal", amount: year.taxResult.flow.totalFederalTax ?? 0 },
            { id: "tax-state", label: "State", amount: year.taxResult.flow.stateTax ?? 0 },
          ]
        : [];
      return drillResult("taxes", "Taxes", year, year.expenses.taxes, rows);
    }

    case "totalExpenses": {
      // Category subtotals. cashGifts is already rolled into expenses.other
      // (see ProjectionYear.expenses doc) so it is deliberately NOT its own
      // row; savings IS part of the column's totalExpenses.
      const e = year.expenses;
      const rows: CellDrillRow[] = [
        { id: "living", label: "Living Expenses", amount: e.living },
        { id: "liabilities", label: "Liabilities", amount: e.liabilities },
        { id: "other", label: "Other Expenses", amount: e.other },
        { id: "insurance", label: "Insurance Premiums", amount: e.insurance },
        { id: "realEstate", label: "Real Estate", amount: e.realEstate },
        { id: "taxes", label: "Taxes", amount: e.taxes },
        { id: "discretionary", label: "Surplus Spent", amount: e.discretionary },
        { id: "savings", label: "Savings", amount: year.savings.total },
      ];
      return drillResult("totalExpenses", "Total Expenses", year, year.totalExpenses, rows);
    }

    case "shortfall": {
      const s = inflows.shortfall;
      if (s < EPSILON) return null;
      const rows: CellDrillRow[] = [
        { id: "expenses", label: "Total Expenses", amount: year.totalExpenses },
        { id: "inflows", label: "Less: Total Income & Withdrawals", amount: -inflows.total },
      ];
      return drillResult("shortfall", "Shortfall", year, s, rows, {
        totalLabel: "Shortfall",
        skipBalance: true,
        footnote:
          "Expenses not covered by income, RMDs, or portfolio withdrawals this year.",
      });
    }

    case "portfolioAssets": {
      const pa = year.portfolioAssets;
      const group = (
        label: string,
        map: Record<string, number>,
        groupTotal: number,
        key: string,
      ): CellDrillGroup => ({
        label,
        rows: balanced(
          key,
          groupTotal,
          Object.entries(map).map(([id, amount]) => ({
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
      ].filter((g) => g.rows.length > 0);
      const total = liquidPortfolioTotal(year);
      if (Math.abs(total) < EPSILON && groups.length === 0) return null;
      return {
        title: `Total Portfolio Assets — ${year.year}`,
        subtitle: ageSubtitle(year),
        total,
        groups,
        footnote:
          "End-of-year balances. Excludes real estate, business interests, life insurance, and locked trust assets.",
      };
    }
  }
}
