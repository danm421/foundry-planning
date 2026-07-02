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
  const m = buildNameMaps(clientData);
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

    // Expense/portfolio arms land in the next task.
    default:
      return null;
  }
}
