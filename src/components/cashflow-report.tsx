"use client";

import { useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line, Chart } from "react-chartjs-2";
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

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

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
  // Income sub-types
  salaries: "Salaries",
  socialSecurity: "Social Security",
  business_income: "Business",
  trust_income: "Trust",
  deferred: "Deferred",
  capitalGains: "Capital Gains",
  other_income: "Other",
  // Expense sub-types
  living: "Living Expenses",
  other_expense: "Other Expenses",
  insurance: "Insurance",
  // Portfolio sub-types
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  realEstate: "Real Estate",
  business_assets: "Business",
  lifeInsurance: "Life Insurance",
};

// Map from income drill segment → income type value in ClientData
const INCOME_SEGMENT_TO_TYPE: Record<string, string> = {
  salaries: "salary",
  socialSecurity: "social_security",
  business_income: "business",
  trust_income: "trust",
  deferred: "deferred",
  capitalGains: "capital_gains",
  other_income: "other",
};

// Map from expense drill segment → expense type value in ClientData
const EXPENSE_SEGMENT_TO_TYPE: Record<string, string> = {
  living: "living",
  other_expense: "other",
  insurance: "insurance",
};

// Map from portfolio drill segment → account category value in ClientData
const PORTFOLIO_SEGMENT_TO_CATEGORY: Record<string, string> = {
  taxable: "taxable",
  cash: "cash",
  retirement: "retirement",
  realEstate: "real_estate",
  business_assets: "business",
  lifeInsurance: "life_insurance",
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
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [chartView, setChartView] = useState<"portfolio" | "cashflow">("portfolio");
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
        setClientData(data);

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

  // ── Chart configurations ────────────────────────────────────────────────────

  const chartLabels = years.map((y) => String(y.year));

  const baseChartOptions = {
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
      legend: { display: true, labels: { color: "#d1d5db", boxWidth: 12, padding: 16 } },
      tooltip: {
        backgroundColor: "#1f2937",
        titleColor: "#f3f4f6",
        bodyColor: "#d1d5db",
        callbacks: {
          label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
            `${ctx.dataset.label}: ${fmtNum(Number(ctx.raw))}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { color: "#9ca3af" },
        grid: { color: "#374151" },
      },
      y: {
        stacked: true,
        ticks: {
          color: "#9ca3af",
          callback: (value: unknown) => fmtNum(Number(value)),
        },
        grid: { color: "#374151" },
      },
    },
  };

  // Portfolio Assets chart (area/line)
  const portfolioChartData = {
    labels: chartLabels,
    datasets: [
      {
        label: "Total Portfolio Assets",
        data: years.map((y) => y.portfolioAssets.total),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  };

  const portfolioChartOptions = {
    ...baseChartOptions,
    scales: {
      x: { ...baseChartOptions.scales.x, stacked: false },
      y: { ...baseChartOptions.scales.y, stacked: false },
    },
  };

  // Cash Flow chart (stacked bars for income/withdrawals/shortfall + expense line)
  const cashflowChartData = {
    labels: chartLabels,
    datasets: [
      {
        type: "bar" as const,
        label: "Income",
        data: years.map((y) => y.income.total),
        backgroundColor: "#22c55e",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "Withdrawals",
        data: years.map((y) => y.withdrawals.total),
        backgroundColor: "#f59e0b",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "Shortfall",
        data: years.map((y) => {
          const gap = y.totalExpenses - y.totalIncome;
          return gap > 0 ? gap : 0;
        }),
        backgroundColor: "#ef4444",
        stack: "inflows",
      },
      {
        type: "line" as const,
        label: "Total Expenses",
        data: years.map((y) => y.expenses.total),
        borderColor: "#f87171",
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
      },
      {
        type: "line" as const,
        label: "Total Income",
        data: years.map((y) => y.income.total),
        borderColor: "#4ade80",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 3],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
      },
    ],
  };

  // ── Derived account ID lists ───────────────────────────────────────────────

  const savingsAccountIds = Array.from(
    new Set(years.flatMap((y) => Object.keys(y.savings.byAccount)))
  );
  const withdrawalAccountIds = Array.from(
    new Set(years.flatMap((y) => Object.keys(y.withdrawals.byAccount)))
  );

  // ── Derived income/expense source maps from clientData ────────────────────

  // incomesByType: segment key → array of income IDs with that type
  const incomesByType: Record<string, string[]> = {};
  const incomeNames: Record<string, string> = {};
  if (clientData) {
    for (const inc of clientData.incomes) {
      incomeNames[inc.id] = inc.name;
      // Find the segment key for this income type
      const segmentKey = Object.entries(INCOME_SEGMENT_TO_TYPE).find(
        ([, t]) => t === inc.type
      )?.[0];
      if (segmentKey) {
        if (!incomesByType[segmentKey]) incomesByType[segmentKey] = [];
        incomesByType[segmentKey].push(inc.id);
      }
    }
  }

  // expensesByType: segment key → array of expense IDs with that type
  const expensesByType: Record<string, string[]> = {};
  const expenseNames: Record<string, string> = {};
  if (clientData) {
    for (const exp of clientData.expenses) {
      expenseNames[exp.id] = exp.name;
      const segmentKey = Object.entries(EXPENSE_SEGMENT_TO_TYPE).find(
        ([, t]) => t === exp.type
      )?.[0];
      if (segmentKey) {
        if (!expensesByType[segmentKey]) expensesByType[segmentKey] = [];
        expensesByType[segmentKey].push(exp.id);
      }
    }
  }

  // accountsByCategory: segment key → array of account IDs with that category
  const accountsByCategory: Record<string, string[]> = {};
  if (clientData) {
    for (const acc of clientData.accounts) {
      const segmentKey = Object.entries(PORTFOLIO_SEGMENT_TO_CATEGORY).find(
        ([, c]) => c === acc.category
      )?.[0];
      if (segmentKey) {
        if (!accountsByCategory[segmentKey]) accountsByCategory[segmentKey] = [];
        accountsByCategory[segmentKey].push(acc.id);
      }
    }
  }

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
    const subLevel = drillPath[1];

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

    // ── Income drill-down ──────────────────────────────────────────────────

    if (level === "income") {
      // Level 2: individual sources for a specific income type
      if (subLevel && INCOME_SEGMENT_TO_TYPE[subLevel] != null) {
        const sourceIds = incomesByType[subLevel] ?? [];
        return [
          ...baseColumns,
          ...sourceIds.map((id) =>
            numCol(
              `income_src_${id}`,
              incomeNames[id] ?? id,
              (r) => r.income.bySource[id] ?? 0
            )
          ),
          numCol(
            "income_subtype_total",
            `${DRILL_LABELS[subLevel] ?? subLevel} Total`,
            (r) => sourceIds.reduce((sum, id) => sum + (r.income.bySource[id] ?? 0), 0),
            true
          ),
        ];
      }

      // Level 1: income categories with drill buttons
      return [
        ...baseColumns,
        numCol("income_salaries", () => <DrillBtn segment="salaries" label="Salaries" />, (r) => r.income.salaries),
        numCol("income_ss", () => <DrillBtn segment="socialSecurity" label="Social Security" />, (r) => r.income.socialSecurity),
        numCol("income_business", () => <DrillBtn segment="business_income" label="Business" />, (r) => r.income.business),
        numCol("income_trust", () => <DrillBtn segment="trust_income" label="Trust" />, (r) => r.income.trust),
        numCol("income_deferred", () => <DrillBtn segment="deferred" label="Deferred" />, (r) => r.income.deferred),
        numCol("income_capgains", () => <DrillBtn segment="capitalGains" label="Capital Gains" />, (r) => r.income.capitalGains),
        numCol("income_other", () => <DrillBtn segment="other_income" label="Other" />, (r) => r.income.other),
        numCol("income_total", "Total", (r) => r.income.total, true),
      ];
    }

    // ── Expenses drill-down ────────────────────────────────────────────────

    if (level === "expenses") {
      // Level 2: individual sources for a specific expense type
      if (subLevel && EXPENSE_SEGMENT_TO_TYPE[subLevel] != null) {
        const sourceIds = expensesByType[subLevel] ?? [];
        return [
          ...baseColumns,
          ...sourceIds.map((id) =>
            numCol(
              `exp_src_${id}`,
              expenseNames[id] ?? id,
              (r) => r.expenses.bySource[id] ?? 0
            )
          ),
          numCol(
            "exp_subtype_total",
            `${DRILL_LABELS[subLevel] ?? subLevel} Total`,
            (r) => sourceIds.reduce((sum, id) => sum + (r.expenses.bySource[id] ?? 0), 0),
            true
          ),
        ];
      }

      // Level 1: expense categories with drill buttons
      return [
        ...baseColumns,
        numCol("expenses_living", () => <DrillBtn segment="living" label="Living" />, (r) => r.expenses.living),
        numCol("expenses_liabilities", "Liabilities", (r) => r.expenses.liabilities),
        numCol("expenses_other", () => <DrillBtn segment="other_expense" label="Other" />, (r) => r.expenses.other),
        numCol("expenses_insurance", () => <DrillBtn segment="insurance" label="Insurance" />, (r) => r.expenses.insurance),
        numCol("expenses_taxes", "Taxes", (r) => r.expenses.taxes),
        numCol("expenses_total", "Total", (r) => r.expenses.total, true),
      ];
    }

    // ── Savings drill-down ─────────────────────────────────────────────────

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

    // ── Withdrawals drill-down ─────────────────────────────────────────────

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

    // ── Portfolio drill-down ───────────────────────────────────────────────

    if (level === "portfolio") {
      // Level 2: individual accounts for a specific portfolio category
      if (subLevel && PORTFOLIO_SEGMENT_TO_CATEGORY[subLevel] != null) {
        const acctIds = accountsByCategory[subLevel] ?? [];
        return [
          ...baseColumns,
          ...acctIds.map((id) =>
            col(
              `portfolio_src_${id}`,
              accountNames[id] ?? id,
              (r) => {
                const categoryKey = subLevel as keyof ProjectionYear["portfolioAssets"];
                const byAcct = r.portfolioAssets[categoryKey] as Record<string, number> | undefined;
                return byAcct?.[id] ?? 0;
              },
              (info) => {
                const v = info.getValue() as number;
                const row = info.row.original;
                return (
                  <button
                    onClick={() => {
                      const ledger = row.accountLedgers[id];
                      if (ledger) {
                        setLedgerModal({
                          accountId: id,
                          accountName: accountNames[id] ?? id,
                          year: row.year,
                          ledger,
                        });
                      }
                    }}
                    className="text-blue-400 hover:text-blue-300 tabular-nums focus:outline-none"
                    title="View account ledger"
                  >
                    {fmtNum(v)}
                  </button>
                );
              }
            )
          ),
          numCol(
            "portfolio_subtype_total",
            `${DRILL_LABELS[subLevel] ?? subLevel} Total`,
            (r) => {
              const categoryKey = subLevel as keyof ProjectionYear["portfolioAssets"];
              const byAcct = r.portfolioAssets[categoryKey] as Record<string, number> | undefined;
              if (!byAcct) return 0;
              return Object.values(byAcct).reduce((s, v) => s + v, 0);
            },
            true
          ),
        ];
      }

      // Level 1: portfolio categories with drill buttons
      return [
        ...baseColumns,
        numCol("portfolio_taxable_total", () => <DrillBtn segment="taxable" label="Taxable" />, (r) => r.portfolioAssets.taxableTotal),
        numCol("portfolio_cash_total", () => <DrillBtn segment="cash" label="Cash" />, (r) => r.portfolioAssets.cashTotal),
        numCol("portfolio_retirement_total", () => <DrillBtn segment="retirement" label="Retirement" />, (r) => r.portfolioAssets.retirementTotal),
        numCol("portfolio_real_estate_total", () => <DrillBtn segment="realEstate" label="Real Estate" />, (r) => r.portfolioAssets.realEstateTotal),
        numCol("portfolio_business_total", () => <DrillBtn segment="business_assets" label="Business" />, (r) => r.portfolioAssets.businessTotal),
        numCol("portfolio_life_insurance_total", () => <DrillBtn segment="lifeInsurance" label="Life Insurance" />, (r) => r.portfolioAssets.lifeInsuranceTotal),
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

      {/* Chart selector + chart */}
      <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            {chartView === "portfolio" ? "Total Portfolio Assets" : "Cash Flow Analysis"}
            <span className="ml-2 text-xs font-normal text-gray-500">— click a point to jump to that year</span>
          </h2>
          <div className="flex rounded-md border border-gray-600 bg-gray-800 text-xs">
            <button
              onClick={() => setChartView("portfolio")}
              className={`px-3 py-1.5 rounded-l-md ${
                chartView === "portfolio"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Portfolio
            </button>
            <button
              onClick={() => setChartView("cashflow")}
              className={`px-3 py-1.5 rounded-r-md ${
                chartView === "cashflow"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Cash Flow
            </button>
          </div>
        </div>
        <div style={{ height: 300 }}>
          {chartView === "portfolio" ? (
            <Line data={portfolioChartData} options={portfolioChartOptions} />
          ) : (
            <Chart type="bar" data={cashflowChartData} options={baseChartOptions} />
          )}
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
