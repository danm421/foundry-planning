"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { TaxDetailModal } from "@/components/cashflow/tax-detail-modal";
import { YearRangeSlider } from "@/components/cashflow/year-range-slider";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

// Draws vertical dashed markers at specific data indices with a short label and a
// colored cap at the top. Used to show retirement and life-expectancy events for
// each client on the cash-flow and portfolio charts. Enable via:
//   options.plugins.timelineMarkers = { markers: [{ yearIndex, label, color }] }
interface TimelineMarker {
  yearIndex: number;
  label: string;
  color: string;
}
const timelineMarkersPlugin = {
  id: "timelineMarkers",
  afterDatasetsDraw(chart: {
    ctx: CanvasRenderingContext2D;
    chartArea: { top: number; bottom: number; left: number; right: number };
    scales: { x: { getPixelForValue(v: number): number } };
  }, _args: unknown, options: { markers?: TimelineMarker[] }) {
    const { ctx, chartArea, scales } = chart;
    const markers = options?.markers ?? [];
    if (markers.length === 0) return;
    ctx.save();
    for (const m of markers) {
      const x = scales.x.getPixelForValue(m.yearIndex);
      if (x < chartArea.left - 1 || x > chartArea.right + 1) continue;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 8);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Cap + label at the top
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, chartArea.top + 6, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(m.label, x, chartArea.top - 2);
    }
    ctx.restore();
  },
};
ChartJS.register(timelineMarkersPlugin);

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerModal {
  accountId: string;
  accountName: string;
  year: number;
  ledger: AccountLedger;
}

interface TaxDrillModal {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
  totalTaxes: number;
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
  accessorFn: (row: ProjectionYear, idx: number) => unknown,
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
  accessorFn: (row: ProjectionYear, idx: number) => number,
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
  cashflow: "Net Cash Flow",
  rmds: "RMDs",
  growth: "Portfolio Growth",
  activity: "Portfolio Activity",
  additions: "Additions",
  distributions: "Distributions",
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
  real_estate_expense: "Real Estate Expenses",
  liabilities: "Liabilities",
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
// Note: "real_estate_expense" sources are synthetic (synth-proptax-*) and
// are populated separately from accounts rather than from clientData.expenses.
const EXPENSE_SEGMENT_TO_TYPE: Record<string, string> = {
  living: "living",
  other_expense: "other",
  insurance: "insurance",
  real_estate_expense: "real_estate",
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
  const [sourceDetailModal, setSourceDetailModal] = useState<{
    name: string;
    year: number;
    amount: number;
    details: { label: string; amount: number }[];
    // When present, the modal renders per-transaction groups (each with its own
    // line-item breakdown and subtotal) instead of a flat `details` list. Used
    // by the consolidated Other Income drill so a single year-column cell can
    // surface all asset transactions that contributed.
    groups?: { name: string; amount: number; details: { label: string; amount: number }[] }[];
  } | null>(null);
  const [taxDrillModal, setTaxDrillModal] = useState<TaxDrillModal | null>(null);
  const [showTaxDetailModal, setShowTaxDetailModal] = useState(false);
  const [taxDrillExpanded, setTaxDrillExpanded] = useState<Set<string>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // ── Year-range slider state ────────────────────────────────────────────────

  const planStartYear =
    clientData?.planSettings.planStartYear ?? new Date().getFullYear();
  const planEndYear =
    clientData?.planSettings.planEndYear ?? planStartYear + 50;

  const clientRetirementYear = useMemo(() => {
    if (!clientData?.client.dateOfBirth || !clientData?.client.retirementAge) {
      return null;
    }
    return (
      parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) +
      clientData.client.retirementAge
    );
  }, [clientData]);

  const [yearRange, setYearRange] = useState<[number, number]>([
    planStartYear,
    planEndYear,
  ]);

  // Reset slider when plan boundaries change (e.g., advisor edits planEndYear in Assumptions)
  useEffect(() => {
    setYearRange([planStartYear, planEndYear]);
  }, [planStartYear, planEndYear]);

  const visibleYears = useMemo(
    () => years.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]),
    [years, yearRange]
  );

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

  const chartLabels = visibleYears.map((y) => String(y.year));

  // Life events — retirement and life-expectancy end — for each client, mapped
  // onto the chart's year axis. Also used to badge the table rows so advisors can
  // jump to an event year quickly.
  const firstYear = visibleYears[0]?.year ?? 0;
  const yearIndex = (year: number) => year - firstYear;
  const inRange = (year: number) =>
    visibleYears.length > 0 && year >= firstYear && year <= visibleYears[visibleYears.length - 1].year;

  const timelineMarkers: TimelineMarker[] = [];
  const eventsByYear: Record<number, { label: string; color: string }[]> = {};
  const pushEvent = (year: number, label: string, color: string) => {
    if (!inRange(year)) return;
    timelineMarkers.push({ yearIndex: yearIndex(year), label, color });
    (eventsByYear[year] ??= []).push({ label, color });
  };

  if (clientData) {
    const c = clientData.client;
    const clientFirst = c.firstName;
    const clientBirthYear = parseInt(c.dateOfBirth.slice(0, 4), 10);
    const clientColor = "#60a5fa";
    pushEvent(clientBirthYear + c.retirementAge, `${clientFirst} retires`, clientColor);
    pushEvent(clientBirthYear + c.planEndAge, `${clientFirst} end`, clientColor);

    if (c.spouseDob) {
      const spouseFirst = c.spouseName ?? "Spouse";
      const spouseBirthYear = parseInt(c.spouseDob.slice(0, 4), 10);
      const spouseColor = "#f472b6";
      if (c.spouseRetirementAge != null) {
        pushEvent(
          spouseBirthYear + c.spouseRetirementAge,
          `${spouseFirst} retires`,
          spouseColor
        );
      }
      pushEvent(spouseBirthYear + c.planEndAge, `${spouseFirst} end`, spouseColor);
    }
  }

  const baseChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_event: unknown, elements: Array<{ index: number }>) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const year = visibleYears[idx]?.year;
        if (year != null) scrollToYear(year);
      }
    },
    layout: { padding: { top: 20 } },
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
        data: visibleYears.map((y) => y.portfolioAssets.total),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  };

  const chartOptionsWithMarkers = {
    ...baseChartOptions,
    plugins: {
      ...baseChartOptions.plugins,
      timelineMarkers: { markers: timelineMarkers },
    },
  };

  const portfolioChartOptions = {
    ...chartOptionsWithMarkers,
    scales: {
      x: { ...baseChartOptions.scales.x, stacked: false },
      y: { ...baseChartOptions.scales.y, stacked: false },
    },
  };

  // Cash Flow chart — stacked bars (bottom → top: Social Security, Salaries,
  // Other Income, RMDs, Withdrawals) with Total Expenses overlaid as a line.
  // Color palette mirrors the reference mock: navy SS anchors the stack, warm
  // colors surface late-plan pressure (RMDs orange, withdrawals red).
  const otherIncomeForYear = (y: ProjectionYear) =>
    y.income.business +
    y.income.deferred +
    y.income.capitalGains +
    y.income.trust +
    y.income.other;

  const rmdForYear = (y: ProjectionYear) =>
    Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);

  const cashflowChartData = {
    labels: chartLabels,
    datasets: [
      {
        type: "bar" as const,
        label: "Social Security",
        data: visibleYears.map((y) => y.income.socialSecurity),
        backgroundColor: "#2563eb",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "Salaries",
        data: visibleYears.map((y) => y.income.salaries),
        backgroundColor: "#16a34a",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "Other Income",
        data: visibleYears.map(otherIncomeForYear),
        backgroundColor: "#99f6e4",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "RMDs",
        data: visibleYears.map(rmdForYear),
        backgroundColor: "#f97316",
        stack: "inflows",
      },
      {
        type: "bar" as const,
        label: "Withdrawals",
        data: visibleYears.map((y) => y.withdrawals.total),
        backgroundColor: "#ef4444",
        stack: "inflows",
      },
      {
        type: "line" as const,
        label: "Total Expenses",
        data: visibleYears.map((y) => y.expenses.total),
        borderColor: "#ffffff",
        backgroundColor: "transparent",
        borderWidth: 2,
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

  // ── Derived income/expense source maps from clientData ────────────────────

  // incomesByType: segment key → array of income IDs with that type
  const incomesByType: Record<string, string[]> = {};
  const incomeNames: Record<string, string> = {};
  const techniqueIncomeIds: string[] = [];
  const techniqueExpenseIds: string[] = [];
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

  // liabilityNames: liability id → display name. Seeded from clientData for
  // original liabilities; synthetic mortgages from asset purchases get their
  // names from the projection's techniqueBreakdown.
  const liabilityNames: Record<string, string> = {};
  if (clientData) {
    for (const liab of clientData.liabilities) {
      liabilityNames[liab.id] = liab.name;
    }
  }
  // Collect all liability IDs that ever appear in any year — this captures
  // synthetic mortgages from BoY purchases that aren't in clientData.liabilities.
  const allLiabilityIds = new Set<string>();
  for (const y of years) {
    if (clientData) {
      for (const liab of clientData.liabilities) allLiabilityIds.add(liab.id);
    }
    for (const p of y.techniqueBreakdown?.purchases ?? []) {
      if (p.liabilityId) {
        allLiabilityIds.add(p.liabilityId);
        if (p.liabilityName) liabilityNames[p.liabilityId] = p.liabilityName;
      }
    }
    // Also pick up any liability id that shows up in expense byLiability
    for (const id of Object.keys(y.expenses.byLiability ?? {})) {
      allLiabilityIds.add(id);
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
    // Synthetic property-tax expenses are generated at projection time (not in
    // clientData.expenses). Build the real_estate_expense drill list from accounts.
    for (const acc of clientData.accounts) {
      if (acc.category !== "real_estate") continue;
      if ((acc.annualPropertyTax ?? 0) <= 0) continue;
      const synthId = `synth-proptax-${acc.id}`;
      expenseNames[synthId] = `Property Tax – ${acc.name}`;
      if (!expensesByType["real_estate_expense"]) expensesByType["real_estate_expense"] = [];
      expensesByType["real_estate_expense"].push(synthId);
    }

    // Technique-generated income and expense sources (sales and purchases).
    // These use synthetic bySource keys added by the projection engine.
    // Technique income sources go into "technique_income" (for Level 0 Other Income
    // drill only), NOT into "other_income" (which is the Income > Other Level 1 drill).
    techniqueIncomeIds.length = 0;
    techniqueExpenseIds.length = 0;

    for (const txn of clientData.assetTransactions ?? []) {
      if (txn.type === "sell") {
        // Net surplus as income (may not exist if deficit)
        const proceedsKey = `technique-proceeds:${txn.id}`;
        incomeNames[proceedsKey] = `Net Proceeds: ${txn.name}`;
        techniqueIncomeIds.push(proceedsKey);

        // Deficit as expense (may not exist if surplus)
        const deficitKey = `technique-deficit:${txn.id}`;
        expenseNames[deficitKey] = `Net Deficit: ${txn.name}`;
        techniqueExpenseIds.push(deficitKey);

        // Transaction costs as expense (only if costs are configured)
        const hasCosts = (txn.transactionCostPct ?? 0) > 0 || (txn.transactionCostFlat ?? 0) > 0;
        if (hasCosts) {
          const costKey = `technique-cost:${txn.id}`;
          expenseNames[costKey] = `Transaction Costs: ${txn.name}`;
          if (!expensesByType["other_expense"]) expensesByType["other_expense"] = [];
          expensesByType["other_expense"].push(costKey);
        }
      }
      if (txn.type === "buy") {
        // Buy-only transactions: purchase equity is a real cash outflow
        const purchaseKey = `technique-purchase:${txn.id}`;
        expenseNames[purchaseKey] = `Purchase: ${txn.name}`;
        if (!expensesByType["other_expense"]) expensesByType["other_expense"] = [];
        expensesByType["other_expense"].push(purchaseKey);
      }
    }
  }

  // accountsByCategory: segment key → array of account IDs with that category
  const accountsByCategory: Record<string, string[]> = {};
  // accountCategoryById: account id → raw account category (used for net-cash-flow drill)
  const accountCategoryById: Record<string, string> = {};
  if (clientData) {
    for (const acc of clientData.accounts) {
      accountCategoryById[acc.id] = acc.category;
      const segmentKey = Object.entries(PORTFOLIO_SEGMENT_TO_CATEGORY).find(
        ([, c]) => c === acc.category
      )?.[0];
      if (segmentKey) {
        if (!accountsByCategory[segmentKey]) accountsByCategory[segmentKey] = [];
        accountsByCategory[segmentKey].push(acc.id);
      }
    }
  }

  // ── Net cash flow drill helpers ───────────────────────────────────────────

  const NET_CASH_FLOW_CATEGORIES: { key: string; label: string }[] = [
    { key: "cash", label: "Cash Assets" },
    { key: "taxable", label: "Taxable Assets" },
    { key: "retirement", label: "Retirement" },
    { key: "real_estate", label: "Real Estate" },
    { key: "business", label: "Business" },
    { key: "life_insurance", label: "Life Insurance" },
  ];

  // Which asset categories had any supplemental withdrawal across the projection — used
  // to avoid rendering empty columns in the Net Cash Flow drill-down.
  const withdrawalCategoriesUsed = new Set<string>();
  for (const y of years) {
    for (const accId of Object.keys(y.withdrawals.byAccount)) {
      const cat = accountCategoryById[accId];
      if (cat) withdrawalCategoriesUsed.add(cat);
    }
  }

  function withdrawalByCategory(r: ProjectionYear, category: string): number {
    let sum = 0;
    for (const [accId, amount] of Object.entries(r.withdrawals.byAccount)) {
      if (accountCategoryById[accId] === category) sum += amount;
    }
    return sum;
  }

  function portfolioBoy(r: ProjectionYear, _idx: number): number {
    // Look up previous year in the full projection (not the visible window) so
    // BoY is always the actual prior-year ending balance, even when the slider
    // starts mid-projection.
    const prevYear = years.find((y) => y.year === r.year - 1);
    if (prevYear) return prevYear.portfolioAssets.total;
    return Object.values(r.accountLedgers).reduce((s, l) => s + l.beginningValue, 0);
  }

  // ── Portfolio growth helpers ──────────────────────────────────────────────

  // Which account IDs appear in the portfolio snapshot for a given year. This is
  // how we stay in sync with the engine's portfolio-inclusion rules (entity-owned
  // accounts only if the entity is flagged includeInPortfolio).
  function portfolioAccountIds(r: ProjectionYear): Set<string> {
    const ids = new Set<string>();
    const buckets: (keyof ProjectionYear["portfolioAssets"])[] = [
      "taxable",
      "cash",
      "retirement",
      "realEstate",
      "business",
      "lifeInsurance",
    ];
    for (const bucket of buckets) {
      const byAcct = r.portfolioAssets[bucket] as Record<string, number> | undefined;
      if (!byAcct) continue;
      for (const id of Object.keys(byAcct)) ids.add(id);
    }
    return ids;
  }

  function portfolioGrowthTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += r.accountLedgers[id]?.growth ?? 0;
    return sum;
  }

  function growthByCategorySegment(r: ProjectionYear, segment: string): number {
    const categoryKey = segment as keyof ProjectionYear["portfolioAssets"];
    const byAcct = r.portfolioAssets[categoryKey] as Record<string, number> | undefined;
    if (!byAcct) return 0;
    let sum = 0;
    for (const id of Object.keys(byAcct)) sum += r.accountLedgers[id]?.growth ?? 0;
    return sum;
  }

  // ── Portfolio activity helpers ─────────────────────────────────────────────

  function additionsTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += r.accountLedgers[id]?.contributions ?? 0;
    return sum;
  }

  function distributionsTotal(r: ProjectionYear): number {
    let sum = 0;
    for (const id of portfolioAccountIds(r)) sum += r.accountLedgers[id]?.distributions ?? 0;
    return sum;
  }

  // Account IDs that had any addition/distribution over the whole projection, so
  // empty columns don't clutter the drill-down for accounts that never moved.
  const additionAccountIds = Array.from(
    new Set(
      years.flatMap((y) =>
        [...portfolioAccountIds(y)].filter(
          (id) => (y.accountLedgers[id]?.contributions ?? 0) > 0
        )
      )
    )
  );
  const distributionAccountIds = Array.from(
    new Set(
      years.flatMap((y) =>
        [...portfolioAccountIds(y)].filter(
          (id) => (y.accountLedgers[id]?.distributions ?? 0) > 0
        )
      )
    )
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

  function buildTechniqueDetails(
    sourceId: string,
    year: number,
    netAmount: number
  ): { label: string; amount: number }[] {
    // Use engine-computed breakdown when available
    const yearData = years.find((y: ProjectionYear) => y.year === year);
    const tb = yearData?.techniqueBreakdown;

    if (sourceId.startsWith("technique-proceeds:")) {
      const txnId = sourceId.replace("technique-proceeds:", "");
      const sale = tb?.sales.find((s) => s.transactionId === txnId);
      if (sale) {
        const details: { label: string; amount: number }[] = [
          { label: "Sale Value", amount: sale.saleValue },
        ];
        if (sale.transactionCosts > 0) details.push({ label: "Transaction Costs", amount: -sale.transactionCosts });
        if (sale.mortgagePaidOff > 0) details.push({ label: "Mortgage Payoff", amount: -sale.mortgagePaidOff });
        return details;
      }
      return [{ label: "Net Proceeds", amount: netAmount }];
    }
    if (sourceId.startsWith("technique-cost:")) {
      const txnId = sourceId.replace("technique-cost:", "");
      const sale = tb?.sales.find((s) => s.transactionId === txnId);
      if (sale && sale.transactionCosts > 0) {
        return [{ label: "Transaction Costs", amount: sale.transactionCosts }];
      }
      return [{ label: "Transaction Costs", amount: netAmount }];
    }
    if (sourceId.startsWith("technique-purchase:")) {
      const txnId = sourceId.replace("technique-purchase:", "");
      const purchase = tb?.purchases.find((p) => p.transactionId === txnId);
      if (purchase) {
        const details: { label: string; amount: number }[] = [
          { label: "Purchase Price", amount: purchase.purchasePrice },
        ];
        if (purchase.mortgageAmount > 0) details.push({ label: "Mortgage", amount: -purchase.mortgageAmount });
        details.push({ label: "Cash Needed", amount: purchase.equity });
        return details;
      }
      return [{ label: "Purchase Equity", amount: netAmount }];
    }
    return [{ label: "Amount", amount: netAmount }];
  }

  function buildColumns(): ColumnDef<ProjectionYear>[] {
    const level = drillPath[0];
    const subLevel = drillPath[1];

    // Always-present base columns
    const baseColumns: ColumnDef<ProjectionYear>[] = [
      col("year", "Year", (r) => r.year, (info) => {
        const y = info.getValue() as number;
        const events = eventsByYear[y];
        if (!events || events.length === 0) return String(y);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span>{y}</span>
            {events.map((ev, i) => (
              <span
                key={i}
                title={ev.label}
                aria-label={ev.label}
                style={{ backgroundColor: ev.color }}
                className="inline-block h-1.5 w-1.5 rounded-full"
              />
            ))}
          </span>
        );
      }),
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
        numCol(
          "rmds_total",
          "RMDs",
          (r) => Object.values(r.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0)
        ),
        numCol(
          "other_income_l0",
          () => <DrillBtn segment="other_income_detail" label="Other Income" />,
          (r) => r.income.other
        ),
        numCol("totalIncome", "Total Income", (r) => r.totalIncome, true),
        numCol("expenses_total", () => <DrillBtn segment="expenses" label="Expenses" />, (r) => r.expenses.total),
        numCol("savings_total", () => <DrillBtn segment="savings" label="Savings" />, (r) => r.savings.total),
        numCol("totalExpenses", "Total Expenses", (r) => r.totalExpenses, true),
        col(
          "netCashFlow",
          () => <DrillBtn segment="cashflow" label="Net Cash Flow" />,
          (r) => r.netCashFlow,
          (info) => {
            const v = info.getValue() as number;
            return (
              <span className={v < 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
                {fmtNum(v)}
              </span>
            );
          }
        ),
        numCol(
          "portfolio_growth",
          () => <DrillBtn segment="growth" label="Portfolio Growth" />,
          (r) => portfolioGrowthTotal(r)
        ),
        numCol(
          "portfolio_activity",
          () => <DrillBtn segment="activity" label="Portfolio Activity" />,
          (r) => additionsTotal(r) - distributionsTotal(r)
        ),
        numCol("portfolio_total", () => <DrillBtn segment="portfolio" label="Portfolio Assets" />, (r) => r.portfolioAssets.total),
      ];
    }

    // ── Other Income direct drill (from Level 0) ────────────────────────
    if (level === "other_income_detail") {
      // Consolidate every surplus-producing asset transaction into a single
      // "Net Proceeds from Asset Transactions" column. Clicking a non-zero
      // year opens a grouped modal with the name + line-item breakdown
      // (sale value, transaction costs, mortgage payoff) for each sale that
      // contributed that year — supports multiple sales in one year.
      const sourceIds = techniqueIncomeIds;
      const techniqueSourceIds = sourceIds.filter((id) => id.startsWith("technique-"));
      const nonTechniqueSourceIds = sourceIds.filter((id) => !id.startsWith("technique-"));
      const yearTotal = (r: ProjectionYear) =>
        techniqueSourceIds.reduce((sum, id) => sum + (r.income.bySource[id] ?? 0), 0);
      return [
        ...baseColumns,
        col(
          "oi_asset_transactions",
          "Net Proceeds from Asset Transactions",
          yearTotal,
          (info) => {
            const v = info.getValue() as number;
            if (v === 0) return <span className="tabular-nums text-gray-500">&mdash;</span>;
            const row = info.row.original;
            return (
              <button
                onClick={() => {
                  const groups = techniqueSourceIds
                    .map((id) => {
                      const amt = row.income.bySource[id] ?? 0;
                      if (amt === 0) return null;
                      return {
                        name: incomeNames[id] ?? id,
                        amount: amt,
                        details: buildTechniqueDetails(id, row.year, amt),
                      };
                    })
                    .filter((g): g is NonNullable<typeof g> => g !== null);
                  setSourceDetailModal({
                    name: "Net Proceeds from Asset Transactions",
                    year: row.year,
                    amount: v,
                    details: [],
                    groups,
                  });
                }}
                className="text-blue-400 hover:text-blue-300 tabular-nums focus:outline-none"
                title="View transaction breakdown"
              >
                {fmtNum(v)}
              </button>
            );
          }
        ),
        // Non-technique Other Income sources (if any) retain their own columns.
        ...nonTechniqueSourceIds.map((id) =>
          numCol(`oi_src_${id}`, incomeNames[id] ?? id, (r) => r.income.bySource[id] ?? 0),
        ),
        numCol(
          "oi_total",
          "Other Income Total",
          (r) => sourceIds.reduce((sum, id) => sum + (r.income.bySource[id] ?? 0), 0),
          true,
        ),
      ];
    }

    // ── Income drill-down ──────────────────────────────────────────────────

    if (level === "income") {
      // Level 2: individual sources for a specific income type
      if (subLevel && INCOME_SEGMENT_TO_TYPE[subLevel] != null) {
        const sourceIds = incomesByType[subLevel] ?? [];
        return [
          ...baseColumns,
          ...sourceIds.map((id) => {
            const isTechnique = id.startsWith("technique-");
            if (isTechnique) {
              return col(
                `income_src_${id}`,
                incomeNames[id] ?? id,
                (r) => r.income.bySource[id] ?? 0,
                (info) => {
                  const v = info.getValue() as number;
                  if (v === 0) return <span className="tabular-nums text-gray-500">&mdash;</span>;
                  const row = info.row.original;
                  return (
                    <button
                      onClick={() => {
                        const details = buildTechniqueDetails(id, row.year, v);
                        setSourceDetailModal({
                          name: incomeNames[id] ?? id,
                          year: row.year,
                          amount: v,
                          details,
                        });
                      }}
                      className="text-blue-400 hover:text-blue-300 tabular-nums focus:outline-none"
                      title="View source details"
                    >
                      {fmtNum(v)}
                    </button>
                  );
                }
              );
            }
            return numCol(
              `income_src_${id}`,
              incomeNames[id] ?? id,
              (r) => r.income.bySource[id] ?? 0
            );
          }),
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
      // Level 2: individual liabilities — includes synthetic mortgages from
      // BoY purchases so they show as their own column.
      if (subLevel === "liabilities") {
        const liabIds = Array.from(allLiabilityIds);
        // Diagnostic for Bug 3: if you see "Home Mortgage" but not a new-mortgage
        // column after buying a home, open devtools and look for this log.
        if (typeof window !== "undefined") {
          console.log("[liabilities drill] ids:", liabIds, "names:", liabilityNames);
        }
        return [
          ...baseColumns,
          ...liabIds.map((id) =>
            numCol(
              `liab_${id}`,
              liabilityNames[id] ?? id,
              (r) => r.expenses.byLiability?.[id] ?? 0
            )
          ),
          numCol(
            "liab_total",
            "Liabilities Total",
            (r) => r.expenses.liabilities,
            true
          ),
        ];
      }

      // Level 2: individual sources for a specific expense type
      if (subLevel && EXPENSE_SEGMENT_TO_TYPE[subLevel] != null) {
        const sourceIds = expensesByType[subLevel] ?? [];
        return [
          ...baseColumns,
          ...sourceIds.map((id) => {
            const isTechnique = id.startsWith("technique-");
            if (isTechnique) {
              return col(
                `exp_src_${id}`,
                expenseNames[id] ?? id,
                (r) => r.expenses.bySource[id] ?? 0,
                (info) => {
                  const v = info.getValue() as number;
                  if (v === 0) return <span className="tabular-nums text-gray-500">&mdash;</span>;
                  const row = info.row.original;
                  return (
                    <button
                      onClick={() => {
                        const details = buildTechniqueDetails(id, row.year, v);
                        setSourceDetailModal({
                          name: expenseNames[id] ?? id,
                          year: row.year,
                          amount: v,
                          details,
                        });
                      }}
                      className="text-blue-400 hover:text-blue-300 tabular-nums focus:outline-none"
                      title="View source details"
                    >
                      {fmtNum(v)}
                    </button>
                  );
                }
              );
            }
            return numCol(
              `exp_src_${id}`,
              expenseNames[id] ?? id,
              (r) => r.expenses.bySource[id] ?? 0
            );
          }),
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
        numCol("expenses_liabilities", () => <DrillBtn segment="liabilities" label="Liabilities" />, (r) => r.expenses.liabilities),
        numCol("expenses_other", () => <DrillBtn segment="other_expense" label="Other" />, (r) => r.expenses.other),
        numCol("expenses_insurance", () => <DrillBtn segment="insurance" label="Insurance" />, (r) => r.expenses.insurance),
        numCol("expenses_real_estate", () => <DrillBtn segment="real_estate_expense" label="Real Estate" />, (r) => r.expenses.realEstate),
        col("expenses_taxes", () => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTaxDetailModal(true);
            }}
            className="hover:text-blue-400 hover:underline"
            title="View multi-year tax detail"
          >
            Taxes
          </button>
        ), (r) => r.expenses.taxes, (info) => {
          const row = info.row.original;
          const v = fmtNum(info.getValue() as number);
          return row.taxDetail ? (
            <button
              className="text-right hover:text-blue-400 hover:underline"
              title="View tax detail"
              onClick={() => setTaxDrillModal({ year: row.year, detail: row.taxDetail!, totalTaxes: row.expenses.taxes })}
            >
              {v}
            </button>
          ) : v;
        }),
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

    // ── Net Cash Flow drill-down ───────────────────────────────────────────
    // When household income can't cover expenses + savings + taxes, the engine
    // pulls from the withdrawal strategy to top up checking. This drill shows
    // where those supplemental withdrawals came from, grouped by asset category,
    // plus the beginning-of-year portfolio and the withdrawal rate.

    if (level === "cashflow") {
      const categoryCols = NET_CASH_FLOW_CATEGORIES.filter((c) =>
        withdrawalCategoriesUsed.has(c.key)
      ).map((c) =>
        numCol(`wd_${c.key}`, c.label, (r) => withdrawalByCategory(r, c.key))
      );

      return [
        ...baseColumns,
        ...categoryCols,
        numCol("wd_total", "Total Withdrawals", (r) => r.withdrawals.total, true),
        numCol("portfolio_boy", "Portfolio (BoY)", (r, idx) => portfolioBoy(r, idx)),
        col(
          "wd_pct",
          "Withdrawal %",
          (r, idx) => {
            const boy = portfolioBoy(r, idx);
            return boy > 0 ? r.withdrawals.total / boy : 0;
          },
          (info) => {
            const v = info.getValue() as number;
            return `${(v * 100).toFixed(2)}%`;
          }
        ),
      ];
    }

    // ── Portfolio Growth drill-down ────────────────────────────────────────
    // Level 1: growth by asset category. Level 2: growth per account, with the
    // same ledger modal the Portfolio drill uses.

    if (level === "growth") {
      if (subLevel && PORTFOLIO_SEGMENT_TO_CATEGORY[subLevel] != null) {
        const acctIds = accountsByCategory[subLevel] ?? [];
        return [
          ...baseColumns,
          ...acctIds.map((id) =>
            col(
              `growth_src_${id}`,
              accountNames[id] ?? id,
              (r) => r.accountLedgers[id]?.growth ?? 0,
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
            "growth_subtype_total",
            `${DRILL_LABELS[subLevel] ?? subLevel} Total`,
            (r) => growthByCategorySegment(r, subLevel),
            true
          ),
        ];
      }

      // Level 1: category totals with drill buttons
      return [
        ...baseColumns,
        numCol("growth_taxable", () => <DrillBtn segment="taxable" label="Taxable" />, (r) => growthByCategorySegment(r, "taxable")),
        numCol("growth_cash", () => <DrillBtn segment="cash" label="Cash" />, (r) => growthByCategorySegment(r, "cash")),
        numCol("growth_retirement", () => <DrillBtn segment="retirement" label="Retirement" />, (r) => growthByCategorySegment(r, "retirement")),
        numCol("growth_real_estate", () => <DrillBtn segment="realEstate" label="Real Estate" />, (r) => growthByCategorySegment(r, "realEstate")),
        numCol("growth_business", () => <DrillBtn segment="business_assets" label="Business" />, (r) => growthByCategorySegment(r, "business")),
        numCol("growth_life_insurance", () => <DrillBtn segment="lifeInsurance" label="Life Insurance" />, (r) => growthByCategorySegment(r, "lifeInsurance")),
        numCol("growth_total", "Total", (r) => portfolioGrowthTotal(r), true),
      ];
    }

    // ── Portfolio Activity drill-down ──────────────────────────────────────
    // Level 1: Additions + Distributions totals. Level 2: per-account under each.
    // Summed across portfolio-eligible accounts; ledger modal on cell click shows
    // the itemized per-account activity for the year.

    const accountLedgerCell = (id: string, accessor: (r: ProjectionYear) => number) =>
      col(
        `activity_${id}`,
        accountNames[id] ?? id,
        accessor,
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
      );

    if (level === "activity") {
      if (subLevel === "additions") {
        return [
          ...baseColumns,
          ...additionAccountIds.map((id) =>
            accountLedgerCell(id, (r) => r.accountLedgers[id]?.contributions ?? 0)
          ),
          numCol("additions_total", "Total Additions", (r) => additionsTotal(r), true),
        ];
      }
      if (subLevel === "distributions") {
        return [
          ...baseColumns,
          ...distributionAccountIds.map((id) =>
            accountLedgerCell(id, (r) => r.accountLedgers[id]?.distributions ?? 0)
          ),
          numCol("distributions_total", "Total Distributions", (r) => distributionsTotal(r), true),
        ];
      }

      // Level 1: Additions + Distributions + Net
      return [
        ...baseColumns,
        numCol(
          "activity_additions",
          () => <DrillBtn segment="additions" label="Additions" />,
          (r) => additionsTotal(r)
        ),
        numCol(
          "activity_distributions",
          () => <DrillBtn segment="distributions" label="Distributions" />,
          (r) => distributionsTotal(r)
        ),
        col(
          "activity_net",
          "Net",
          (r) => additionsTotal(r) - distributionsTotal(r),
          (info) => {
            const v = info.getValue() as number;
            return (
              <strong className={v < 0 ? "text-red-400" : "text-green-400"}>{fmtNum(v)}</strong>
            );
          }
        ),
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
    data: visibleYears,
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

      {/* Year-range slider */}
      <div className="mb-4">
        <YearRangeSlider
          min={planStartYear}
          max={planEndYear}
          value={yearRange}
          onChange={setYearRange}
          clientRetirementYear={clientRetirementYear}
        />
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
            <Chart type="bar" data={cashflowChartData} options={chartOptionsWithMarkers} />
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
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-800 p-6 pb-4">
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

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="flex items-center justify-between rounded-md bg-gray-800/60 px-4 py-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Beginning</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-200">
                    {fmtNum(ledgerModal.ledger.beginningValue)}
                  </p>
                </div>
                <div className="text-gray-600">→</div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Ending</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-100">
                    {fmtNum(ledgerModal.ledger.endingValue)}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Activity
                </p>
                {ledgerModal.ledger.entries.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-gray-500 italic">
                    No activity this year.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-800 rounded-md border border-gray-800">
                    {ledgerModal.ledger.entries.map((entry, i) => {
                      const positive = entry.amount >= 0;
                      return (
                        <li key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-gray-200">{entry.label}</p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-500">
                              {entry.category.replace(/_/g, " ")}
                            </p>
                          </div>
                          <span
                            className={`flex-shrink-0 tabular-nums text-sm font-medium ${
                              positive ? "text-green-400" : "text-red-400"
                            }`}
                          >
                            {positive ? "+" : ""}
                            {fmtNum(entry.amount)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {ledgerModal.ledger.growthDetail && (
                <div className="rounded-md border border-gray-800 bg-gray-800/30 px-3 py-2">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Growth Realization</p>
                  <div className="space-y-1 text-sm">
                    {[
                      { label: "Ordinary Income", amount: ledgerModal.ledger.growthDetail.ordinaryIncome, note: "taxed, +basis" },
                      { label: "Qualified Dividends", amount: ledgerModal.ledger.growthDetail.qualifiedDividends, note: "taxed, +basis" },
                      { label: "ST Capital Gains", amount: ledgerModal.ledger.growthDetail.stCapitalGains, note: "taxed, +basis" },
                      { label: "LT Capital Gains", amount: ledgerModal.ledger.growthDetail.ltCapitalGains, note: "+value only" },
                      { label: "Tax-Exempt", amount: ledgerModal.ledger.growthDetail.taxExempt, note: "+basis" },
                    ].filter((r) => r.amount > 0).map((r) => (
                      <div key={r.label} className="flex justify-between">
                        <span className="text-gray-400">{r.label} <span className="text-gray-600 text-xs">({r.note})</span></span>
                        <span className="tabular-nums text-gray-300">{fmtNum(r.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-gray-700 pt-1">
                      <span className="text-gray-400">Basis increase</span>
                      <span className="tabular-nums font-medium text-gray-200">{fmtNum(ledgerModal.ledger.growthDetail.basisIncrease)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between border-t border-gray-800 pt-3 text-sm">
                <span className="text-gray-400">Net change</span>
                <span
                  className={`tabular-nums font-semibold ${
                    ledgerModal.ledger.endingValue - ledgerModal.ledger.beginningValue >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {fmtNum(ledgerModal.ledger.endingValue - ledgerModal.ledger.beginningValue)}
                </span>
              </div>
            </div>

            <div className="flex justify-end border-t border-gray-800 p-4">
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

      {/* Source Detail Modal */}
      {sourceDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSourceDetailModal(null)}>
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-100">{sourceDetailModal.name}</h3>
              <button onClick={() => setSourceDetailModal(null)} className="text-gray-400 hover:text-gray-200 focus:outline-none" aria-label="Close">
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-3">Year: {sourceDetailModal.year}</p>
            {sourceDetailModal.groups && sourceDetailModal.groups.length > 0 ? (
              <div className="space-y-4">
                {sourceDetailModal.groups.map((g, gi) => (
                  <div key={gi}>
                    <div className="text-sm font-semibold text-gray-200 mb-1.5">{g.name}</div>
                    <div className="space-y-1.5 pl-2 border-l border-gray-800">
                      {g.details.map((d, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-400">{d.label}</span>
                          <span className={`tabular-nums ${d.amount < 0 ? "text-red-400" : "text-gray-200"}`}>
                            {fmtNum(d.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm pt-1.5 mt-1.5 border-t border-gray-800">
                        <span className="text-gray-300 font-medium">Net Proceeds</span>
                        <span className={`tabular-nums font-medium ${g.amount < 0 ? "text-red-400" : "text-gray-100"}`}>
                          {fmtNum(g.amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {sourceDetailModal.details.map((d, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-300">{d.label}</span>
                    <span className={`tabular-nums ${d.amount < 0 ? "text-red-400" : "text-gray-100"}`}>
                      {fmtNum(d.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-gray-700 flex justify-between text-sm font-semibold">
              <span className="text-gray-200">Total</span>
              <span className="text-gray-100 tabular-nums">
                {fmtNum(sourceDetailModal.amount)}
              </span>
            </div>
          </div>
        </div>
      )}

      {showTaxDetailModal && (
        <TaxDetailModal
          years={visibleYears}
          onClose={() => setShowTaxDetailModal(false)}
          onYearClick={(y) => {
            if (y.taxDetail) {
              setTaxDrillModal({
                year: y.year,
                detail: y.taxDetail,
                totalTaxes: y.expenses.taxes,
              });
            }
          }}
          yearRange={yearRange}
          onYearRangeChange={setYearRange}
          planStartYear={planStartYear}
          planEndYear={planEndYear}
          clientRetirementYear={clientRetirementYear}
        />
      )}

      {taxDrillModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => { setTaxDrillModal(null); setTaxDrillExpanded(new Set()); }}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-100">Tax Detail — {taxDrillModal.year}</h3>
              <button onClick={() => { setTaxDrillModal(null); setTaxDrillExpanded(new Set()); }} className="text-gray-400 hover:text-gray-200">✕</button>
            </div>

            <p className="mb-3 text-xs text-gray-500">Click a category to see the sources.</p>

            <div className="space-y-2">
              {[
                { label: "Earned Income", key: "earnedIncome" as const, taxType: "earned_income" },
                { label: "Ordinary Income", key: "ordinaryIncome" as const, taxType: "ordinary_income" },
                { label: "Dividends", key: "dividends" as const, taxType: "dividends" },
                { label: "Capital Gains (LT)", key: "capitalGains" as const, taxType: "capital_gains" },
                { label: "ST Capital Gains", key: "stCapitalGains" as const, taxType: "stcg" },
                { label: "QBI", key: "qbi" as const, taxType: "qbi" },
                { label: "Tax-Exempt", key: "taxExempt" as const, taxType: "tax_exempt" },
              ]
                .filter((row) => taxDrillModal.detail[row.key] > 0)
                .map((row) => {
                  const isExpanded = taxDrillExpanded.has(row.key);
                  // Build source list for this category. For incomes the source
                  // id matches an entry in clientData.incomes. For realization
                  // keys like `${acctId}:oi` we split and use accountNames.
                  const sources = Object.entries(taxDrillModal.detail.bySource)
                    .filter(([, v]) => v.type === row.taxType)
                    .map(([sourceId, v]) => {
                      if (sourceId.includes(":")) {
                        const [acctId, kind] = sourceId.split(":");
                        const suffix =
                          kind === "oi" ? "OI"
                          : kind === "qdiv" ? "Qual Div"
                          : kind === "stcg" ? "ST CG"
                          : kind === "rmd" ? "RMD"
                          : kind;
                        const name = accountNames[acctId] ?? acctId;
                        return { id: sourceId, label: `${name} — ${suffix}`, amount: v.amount };
                      }
                      const inc = clientData?.incomes.find((i) => i.id === sourceId);
                      return { id: sourceId, label: inc?.name ?? sourceId, amount: v.amount };
                    })
                    .sort((a, b) => b.amount - a.amount);

                  return (
                    <div key={row.key} className="rounded-md bg-gray-800/40 text-sm">
                      <button
                        type="button"
                        onClick={() => {
                          setTaxDrillExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.key)) next.delete(row.key);
                            else next.add(row.key);
                            return next;
                          });
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/70"
                        disabled={sources.length === 0}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{sources.length > 0 ? (isExpanded ? "▾" : "▸") : " "}</span>
                          <span className="font-medium text-gray-200">{row.label}</span>
                        </span>
                        <span className="tabular-nums text-gray-300">{fmtNum(taxDrillModal.detail[row.key])}</span>
                      </button>
                      {isExpanded && sources.length > 0 && (
                        <ul className="divide-y divide-gray-800 border-t border-gray-800">
                          {sources.map((s) => (
                            <li key={s.id} className="flex items-center justify-between px-3 py-1.5 pl-8 text-xs">
                              <span className="truncate text-gray-400">{s.label}</span>
                              <span className="tabular-nums text-gray-400">{fmtNum(s.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="mt-4 flex justify-between border-t border-gray-700 pt-3 text-sm font-semibold text-gray-100">
              <span>Total Taxes</span>
              <span className="tabular-nums">{fmtNum(taxDrillModal.totalTaxes)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
