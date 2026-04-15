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

// ── Component ─────────────────────────────────────────────────────────────────

interface CashFlowReportProps {
  clientId: string;
}

type ExpandableColumn = "income" | "expenses" | "savings" | "withdrawals" | "portfolio";

export default function CashFlowReport({ clientId }: CashFlowReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [expandedColumns, setExpandedColumns] = useState<Set<ExpandableColumn>>(new Set());
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

  // ── Column expansion ───────────────────────────────────────────────────────

  function toggleColumn(c: ExpandableColumn) {
    setExpandedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(c)) {
        next.delete(c);
      } else {
        next.add(c);
      }
      return next;
    });
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
        callbacks: {
          label: (ctx: { raw: unknown }) => fmtNum(Number(ctx.raw)),
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (value: unknown) => fmtNum(Number(value)),
        },
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
  const portfolioAccountIds = Array.from(
    new Set(
      years.flatMap((y) => [
        ...Object.keys(y.portfolioAssets.taxable),
        ...Object.keys(y.portfolioAssets.cash),
        ...Object.keys(y.portfolioAssets.retirement),
      ])
    )
  );

  // ── Expand button ──────────────────────────────────────────────────────────

  function ExpandBtn({ c, label }: { c: ExpandableColumn; label: string }) {
    const isOpen = expandedColumns.has(c);
    return (
      <button
        onClick={() => toggleColumn(c)}
        className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-800 focus:outline-none whitespace-nowrap"
        title={isOpen ? "Collapse" : "Expand"}
      >
        {label}
        <span className="text-xs">{isOpen ? "▲" : "▼"}</span>
      </button>
    );
  }

  function CollapseBtn({ c }: { c: ExpandableColumn }) {
    return (
      <button
        onClick={() => toggleColumn(c)}
        className="text-blue-600 hover:text-blue-800 text-xs mr-1"
        title="Collapse"
      >
        ▲
      </button>
    );
  }

  // ── Column definitions ─────────────────────────────────────────────────────

  const columns: ColumnDef<ProjectionYear>[] = [
    col("year", "Year", (r) => r.year, (info) => String(info.getValue())),
    col("ages", "Age(s)", (r) => r.ages, (info) => {
      const ages = info.getValue() as ProjectionYear["ages"];
      return ages.spouse != null ? `${ages.client} / ${ages.spouse}` : String(ages.client);
    }),

    // ── Income ────────────────────────────────────────────────────────────────
    ...(!expandedColumns.has("income")
      ? [numCol("income_total", () => <ExpandBtn c="income" label="Income" />, (r) => r.income.total)]
      : [
          numCol("income_salaries", () => <span><CollapseBtn c="income" />Salaries</span>, (r) => r.income.salaries),
          numCol("income_ss", "Social Security", (r) => r.income.socialSecurity),
          numCol("income_business", "Business", (r) => r.income.business),
          numCol("income_trust", "Trust", (r) => r.income.trust),
          numCol("income_deferred", "Deferred", (r) => r.income.deferred),
          numCol("income_capgains", "Capital Gains", (r) => r.income.capitalGains),
          numCol("income_other", "Other", (r) => r.income.other),
          numCol("income_subtotal", "Income Total", (r) => r.income.total, true),
        ]),

    // ── Withdrawals ───────────────────────────────────────────────────────────
    ...(!expandedColumns.has("withdrawals")
      ? [numCol("withdrawals_total", () => <ExpandBtn c="withdrawals" label="Withdrawals" />, (r) => r.withdrawals.total)]
      : [
          ...withdrawalAccountIds.map((accId, idx) =>
            numCol(
              `withdrawal_${accId}`,
              () => (
                <span>
                  {idx === 0 && <CollapseBtn c="withdrawals" />}
                  {accountNames[accId] ?? accId}
                </span>
              ),
              (r) => r.withdrawals.byAccount[accId] ?? 0
            )
          ),
          numCol("withdrawals_subtotal", "Withdrawals Total", (r) => r.withdrawals.total, true),
        ]),

    numCol("totalIncome", "Total Income", (r) => r.totalIncome, true),

    // ── Expenses ──────────────────────────────────────────────────────────────
    ...(!expandedColumns.has("expenses")
      ? [numCol("expenses_total", () => <ExpandBtn c="expenses" label="Expenses" />, (r) => r.expenses.total)]
      : [
          numCol("expenses_living", () => <span><CollapseBtn c="expenses" />Living</span>, (r) => r.expenses.living),
          numCol("expenses_liabilities", "Liabilities", (r) => r.expenses.liabilities),
          numCol("expenses_other", "Other", (r) => r.expenses.other),
          numCol("expenses_insurance", "Insurance", (r) => r.expenses.insurance),
          numCol("expenses_taxes", "Taxes", (r) => r.expenses.taxes),
          numCol("expenses_subtotal", "Expenses Total", (r) => r.expenses.total, true),
        ]),

    // ── Savings ───────────────────────────────────────────────────────────────
    ...(!expandedColumns.has("savings")
      ? [numCol("savings_total", () => <ExpandBtn c="savings" label="Savings" />, (r) => r.savings.total)]
      : [
          ...savingsAccountIds.map((accId, idx) =>
            numCol(
              `savings_${accId}`,
              () => (
                <span>
                  {idx === 0 && <CollapseBtn c="savings" />}
                  {accountNames[accId] ?? accId}
                </span>
              ),
              (r) => r.savings.byAccount[accId] ?? 0
            )
          ),
          numCol("savings_subtotal", "Savings Total", (r) => r.savings.total, true),
          numCol("savings_employer", "Employer Total", (r) => r.savings.employerTotal),
        ]),

    numCol("totalExpenses", "Total Expenses", (r) => r.totalExpenses, true),

    col("netCashFlow", "Net Cash Flow", (r) => r.netCashFlow, (info) => {
      const v = info.getValue() as number;
      return (
        <span className={v < 0 ? "text-red-600 font-semibold" : "font-semibold"}>
          {fmtNum(v)}
        </span>
      );
    }),

    // ── Portfolio Assets ──────────────────────────────────────────────────────
    ...(!expandedColumns.has("portfolio")
      ? [numCol("portfolio_total", () => <ExpandBtn c="portfolio" label="Total Portfolio Assets" />, (r) => r.portfolioAssets.total)]
      : [
          numCol("portfolio_taxable_total", () => <span><CollapseBtn c="portfolio" />Taxable Total</span>, (r) => r.portfolioAssets.taxableTotal),
          numCol("portfolio_cash_total", "Cash Total", (r) => r.portfolioAssets.cashTotal),
          numCol("portfolio_retirement_total", "Retirement Total", (r) => r.portfolioAssets.retirementTotal),
          ...portfolioAccountIds.map((accId) =>
            col(
              `portfolio_account_${accId}`,
              accountNames[accId] ?? accId,
              (r) => {
                const pa = r.portfolioAssets;
                return pa.taxable[accId] ?? pa.cash[accId] ?? pa.retirement[accId] ?? 0;
              },
              (info) => {
                const row = info.row.original;
                const value = info.getValue() as number;
                const ledger = row.accountLedgers[accId];
                if (!ledger) return fmtNum(value);
                return (
                  <button
                    onClick={() =>
                      setLedgerModal({
                        accountId: accId,
                        accountName: accountNames[accId] ?? accId,
                        year: row.year,
                        ledger,
                      })
                    }
                    className="text-blue-600 hover:underline focus:outline-none"
                  >
                    {fmtNum(value)}
                  </button>
                );
              }
            )
          ),
          numCol("portfolio_subtotal", "Portfolio Total", (r) => r.portfolioAssets.total, true),
        ]),
  ];

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
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading projection...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
        Error: {error}
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  return (
    <div>
      {/* Scenario selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Scenario:</label>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
          value="base"
          disabled
        >
          <option value="base">Base Case</option>
        </select>
        <span className="text-xs text-gray-400">(Multi-scenario support coming soon)</span>
      </div>

      {/* Bar chart */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Annual Net Cash Flow — click a bar to jump to that year
        </h2>
        <div style={{ height: 300 }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Table */}
      <div
        ref={tableRef}
        className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
      >
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-600 first:pl-4 last:pr-4"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.map((row) => {
              const isNegative = row.original.netCashFlow < 0;
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.original.year, el);
                  }}
                  className={isNegative ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-3 py-2 first:pl-4 last:pr-4 tabular-nums"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setLedgerModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {ledgerModal.accountName}
                </h3>
                <p className="text-sm text-gray-500">Year {ledgerModal.year} Ledger</p>
              </div>
              <button
                onClick={() => setLedgerModal(null)}
                className="ml-4 text-gray-400 hover:text-gray-600 focus:outline-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
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
                    <td className="py-2 text-gray-600">{label}</td>
                    <td
                      className={`py-2 text-right tabular-nums font-medium ${
                        label === "Ending Value" ? "text-gray-900" : ""
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
                className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none"
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
