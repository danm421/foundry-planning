"use client";

import { useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type CellContext,
} from "@tanstack/react-table";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear, AccountLedger } from "@/engine";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerModal {
  accountId: string;
  accountName: string;
  year: number;
  ledger: AccountLedger;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtNum(v: number) {
  return fmt.format(v);
}

function col(
  id: string,
  header: ColumnDef<ProjectionYear>["header"],
  accessorFn: (row: ProjectionYear) => unknown,
  cellFn?: (info: CellContext<ProjectionYear, unknown>) => React.ReactNode
): ColumnDef<ProjectionYear> {
  return {
    id,
    header,
    accessorFn,
    cell: cellFn ?? ((info) => String(info.getValue())),
  };
}

function numCol(
  id: string,
  header: ColumnDef<ProjectionYear>["header"],
  accessorFn: (row: ProjectionYear) => number,
  bold = false
): ColumnDef<ProjectionYear> {
  return col(id, header, accessorFn, (info) => {
    const v = fmtNum(info.getValue() as number);
    return bold ? <strong>{v}</strong> : v;
  });
}

// ── Drill-down path labels ──────────────────────────────────────────────────

const DRILL_LABELS: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  savings: "Savings",
  withdrawals: "Withdrawals",
  portfolio: "Portfolio Assets",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface CashFlowReportProps {
  clientId: string;
}

export default function CashFlowReport({ clientId }: CashFlowReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [ledgerModal, setLedgerModal] = useState<LedgerModal | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // ── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as ClientData;

        // Build account name lookup
        const names: Record<string, string> = {};
        for (const acc of data.accounts) {
          names[acc.id] = acc.name;
        }
        setAccountNames(names);

        // Run projection client-side
        const projection = runProjection(data);
        setYears(projection);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  // ── Drill-down navigation ─────────────────────────────────────────────────

  function drillInto(segment: string) {
    setDrillPath((prev) => [...prev, segment]);
  }

  function drillTo(index: number) {
    setDrillPath((prev) => prev.slice(0, index));
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────

  function scrollToYear(year: number) {
    const row = rowRefs.current.get(year);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ── Derived data for chart ─────────────────────────────────────────────────

  const chartData = {
    labels: years.map((y) => String(y.year)),
    datasets: [
      {
        label: "Net Cash Flow",
        data: years.map((y) => y.netCashFlow),
        backgroundColor: years.map((y) =>
          y.netCashFlow >= 0 ? "#22c55e" : "#ef4444"
        ),
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_event: unknown, elements: Array<{ index: number }>) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const year = years[idx]?.year;
        if (year != null) scrollToYear(year);
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1f2937",
        titleColor: "#f3f4f6",
        bodyColor: "#d1d5db",
        callbacks: {
          label: (ctx: { raw: unknown }) => fmtNum(Number(ctx.raw)),
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9ca3af" },
        grid: { color: "#374151" },
      },
      y: {
        ticks: {
          color: "#9ca3af",
          callback: (value: unknown) => fmtNum(Number(value)),
        },
        grid: { color: "#374151" },
      },
    },
  };

  // ── Derived account ID lists ───────────────────────────────────────────────

  const savingsAccountIds = Array.from(
    new Set(years.flatMap((y) => Object.keys(y.savings.byAccount)))
  );
  const withdrawalAccountIds = Array.from(
    new Set(years.flatMap((y) => Object.keys(y.withdrawals.byAccount)))
  );

  // ── Drillable header button ────────────────────────────────────────────────

  function DrillBtn({ segment, label }: { segment: string; label: string }) {
    return (
      <button
        onClick={() => drillInto(segment)}
        className="flex items-center gap-1 font-medium text-blue-500 hover:text-blue-400 focus:outline-none whitespace-nowrap"
        title={`Drill into ${label}`}
      >
        {label}
        <span className="text-xs">&#9654;</span>
      </button>
    );
  }

  // ── Column definitions based on drill path ────────────────────────────────

  function buildColumns(): ColumnDef<ProjectionYear>[] {
    const level = drillPath[0];

    // Always-present base columns
    const baseColumns: ColumnDef<ProjectionYear>[] = [
      col("year", "Year", (r) => r.year, (info) => String(info.getValue())),
      col("ages", "Age(s)", (r) => r.ages, (info) => {
        const ages = info.getValue() as ProjectionYear["ages"];
        return ages.spouse != null ? `${ages.client} / ${ages.spouse}` : String(ages.client);
      }),
    ];

    // Top-level: show summary columns
    if (!level) {
      return [
        ...baseColumns,
        numCol("income_total", () => <DrillBtn segment="income" label="Income" />, (r) => r.income.total),
        numCol("withdrawals_total", () => <DrillBtn segment="withdrawals" label="Withdrawals" />, (r) => r.withdrawals.total),
        numCol("totalIncome", "Total Income", (r) => r.totalIncome, true),
        numCol("expenses_total", () => <DrillBtn segment="expenses" label="Expenses" />, (r) => r.expenses.total),
        numCol("savings_total", () => <DrillBtn segment="savings" label="Savings" />, (r) => r.savings.total),
        numCol("totalExpenses", "Total Expenses", (r) => r.totalExpenses, true),
        col("netCashFlow", "Net Cash Flow", (r) => r.netCashFlow, (info) => {
          const v = info.getValue() as number;
          return (
            <span className={v < 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
              {fmtNum(v)}
            </span>
          );
        }),
        numCol("portfolio_total", () => <DrillBtn segment="portfolio" label="Portfolio Assets" />, (r) => r.portfolioAssets.total),
      ];
    }

    // Drill-down: Income
    if (level === "income") {
      return [
        ...baseColumns,
        numCol("income_salaries", "Salaries", (r) => r.income.salaries),
        numCol("income_ss", "Social Security", (r) => r.income.socialSecurity),
        numCol("income_business", "Business", (r) => r.income.business),
        numCol("income_trust", "Trust", (r) => r.income.trust),
        numCol("income_deferred", "Deferred", (r) => r.income.deferred),
        numCol("income_capgains", "Capital Gains", (r) => r.income.capitalGains),
        numCol("income_other", "Other", (r) => r.income.other),
        numCol("income_total", "Total", (r) => r.income.total, true),
      ];
    }

    // Drill-down: Expenses
    if (level === "expenses") {
      return [
        ...baseColumns,
        numCol("expenses_living", "Living", (r) => r.expenses.living),
        numCol("expenses_liabilities", "Liabilities", (r) => r.expenses.liabilities),
        numCol("expenses_other", "Other", (r) => r.expenses.other),
        numCol("expenses_insurance", "Insurance", (r) => r.expenses.insurance),
        numCol("expenses_taxes", "Taxes", (r) => r.expenses.taxes),
        numCol("expenses_total", "Total", (r) => r.expenses.total, true),
      ];
    }

    // Drill-down: Savings
    if (level === "savings") {
      return [
        ...baseColumns,
        ...savingsAccountIds.map((accId) =>
          numCol(
            `savings_${accId}`,
            accountNames[accId] ?? accId,
            (r) => r.savings.byAccount[accId] ?? 0
          )
        ),
        numCol("savings_total", "Total", (r) => r.savings.total, true),
        numCol("savings_employer", "Employer Total", (r) => r.savings.employerTotal),
      ];
    }

    // Drill-down: Withdrawals
    if (level === "withdrawals") {
      return [
        ...baseColumns,
        ...withdrawalAccountIds.map((accId) =>
          numCol(
            `withdrawal_${accId}`,
            accountNames[accId] ?? accId,
            (r) => r.withdrawals.byAccount[accId] ?? 0
          )
        ),
        numCol("withdrawals_total", "Total", (r) => r.withdrawals.total, true),
      ];
    }

    // Drill-down: Portfolio Assets
    if (level === "portfolio") {
      return [
        ...baseColumns,
        numCol("portfolio_taxable_total", "Taxable", (r) => r.portfolioAssets.taxableTotal),
        numCol("portfolio_cash_total", "Cash", (r) => r.portfolioAssets.cashTotal),
        numCol("portfolio_retirement_total", "Retirement", (r) => r.portfolioAssets.retirementTotal),
        numCol("portfolio_real_estate_total", "Real Estate", (r) => r.portfolioAssets.realEstateTotal),
        numCol("portfolio_business_total", "Business", (r) => r.portfolioAssets.businessTotal),
        numCol("portfolio_life_insurance_total", "Life Insurance", (r) => r.portfolioAssets.lifeInsuranceTotal),
        numCol("portfolio_total", "Total", (r) => r.portfolioAssets.total, true),
      ];
    }

    // Fallback (shouldn't happen)
    return baseColumns;
  }

  const columns = buildColumns();

  // ── Table instance ─────────────────────────────────────────────────────────

  const table = useReactTable({
    data: years,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        Loading projection...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/50 p-6 text-red-400">
        Error: {error}
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  return (
    <div>
      {/* Scenario selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-300">Scenario:</label>
        <select
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 shadow-sm focus:border-blue-500 focus:outline-none"
          value="base"
          disabled
        >
          <option value="base">Base Case</option>
        </select>
        <span className="text-xs text-gray-500">(Multi-scenario support coming soon)</span>
      </div>

      {/* Bar chart */}
      <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">
          Annual Net Cash Flow — click a bar to jump to that year
        </h2>
        <div style={{ height: 300 }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Breadcrumb navigation */}
      {drillPath.length > 0 && (
        <div className="mb-3 flex items-center gap-1 text-sm">
          <button
            onClick={() => drillTo(0)}
            className="text-blue-500 hover:text-blue-400 font-medium"
          >
            Cash Flow
          </button>
          {drillPath.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-gray-500">/</span>
              {i < drillPath.length - 1 ? (
                <button
                  onClick={() => drillTo(i + 1)}
                  className="text-blue-500 hover:text-blue-400 font-medium"
                >
                  {DRILL_LABELS[segment] ?? segment}
                </button>
              ) : (
                <span className="text-gray-100 font-medium">
                  {DRILL_LABELS[segment] ?? segment}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <div
        ref={tableRef}
        className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900"
      >
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-800">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="whitespace-nowrap border-b border-gray-700 px-3 py-2 text-left text-xs font-medium text-gray-400 first:pl-4 last:pr-4"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-800">
            {table.getRowModel().rows.map((row) => {
              const isNegative = row.original.netCashFlow < 0;
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.original.year, el);
                  }}
                  className={isNegative ? "bg-red-950/40 hover:bg-red-950/60" : "hover:bg-gray-800"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-3 py-2 first:pl-4 last:pr-4 tabular-nums text-gray-100"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Account Ledger Modal */}
      {ledgerModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setLedgerModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-gray-900 border border-gray-700 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-100">
                  {ledgerModal.accountName}
                </h3>
                <p className="text-sm text-gray-400">Year {ledgerModal.year} Ledger</p>
              </div>
              <button
                onClick={() => setLedgerModal(null)}
                className="ml-4 text-gray-400 hover:text-gray-200 focus:outline-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-800">
                {(
                  [
                    ["Beginning Value", ledgerModal.ledger.beginningValue],
                    ["Growth", ledgerModal.ledger.growth],
                    ["Contributions", ledgerModal.ledger.contributions],
                    ["Distributions", ledgerModal.ledger.distributions],
                    ["Fees", ledgerModal.ledger.fees],
                    ["Ending Value", ledgerModal.ledger.endingValue],
                  ] as [string, number][]
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td className="py-2 text-gray-400">{label}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-medium ${
                        label === "Ending Value" ? "text-gray-100" : "text-gray-300"
                      }`}
                    >
                      {fmtNum(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setLedgerModal(null)}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 focus:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
