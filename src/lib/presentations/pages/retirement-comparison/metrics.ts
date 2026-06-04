// src/lib/presentations/pages/retirement-comparison/metrics.ts
import type { ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-data";
import { yearsFullyFunded, lifetimeTaxes } from "@/lib/solver/solver-summary-metrics";
import { fmtUsdCompact } from "./format";
import type {
  ComparisonKpi,
  OverlayBar,
  PortfolioMatrix,
  PortfolioMatrixCell,
} from "./types";

export interface RetirementComparisonMetricsInput {
  baseYears: ProjectionYear[];
  scenarioYears: ProjectionYear[];
  baseSuccess: number | null;     // 0..1 or null when MC unavailable
  scenarioSuccess: number | null;
  retirementYear: number;
}

export interface RetirementComparisonMetrics {
  kpis: ComparisonKpi[];
  overlay: OverlayBar[];
  matrix: PortfolioMatrix;
}

const fmtPct = (v: number | null): string => (v == null ? "—" : `${Math.round(v * 100)}%`);

const signed = (v: number, fmt: (n: number) => string) =>
  v >= 0 ? `+${fmt(v)}` : `−${fmt(Math.abs(v))}`;

function cellAt(years: ProjectionYear[], year: number): PortfolioMatrixCell {
  const y = years.find((r) => r.year === year) ?? years[years.length - 1];
  const pa = y.portfolioAssets;
  return {
    total: pa.liquidTotal,
    cash: pa.cashTotal,
    retirement: pa.retirementTotal,
    taxable: pa.taxableTotal,
  };
}

export function buildRetirementComparisonMetrics(
  input: RetirementComparisonMetricsInput,
): RetirementComparisonMetrics {
  const { baseYears, scenarioYears, baseSuccess, scenarioSuccess, retirementYear } = input;

  // Overlay (blue floor / green scenario-ahead / grey base-ahead), keyed on scenario years.
  const baseByYear = new Map(baseYears.map((y) => [y.year, Math.max(0, liquidPortfolioTotal(y))]));
  const overlay: OverlayBar[] = scenarioYears.map((y) => {
    const scn = Math.max(0, liquidPortfolioTotal(y));
    const base = baseByYear.get(y.year) ?? scn;
    return {
      year: y.year,
      floor: Math.min(scn, base),
      scenarioAhead: Math.max(0, scn - base),
      baseAhead: Math.max(0, base - scn),
    };
  });

  const endOfLifeYear = scenarioYears[scenarioYears.length - 1]?.year ?? retirementYear;
  const matrix: PortfolioMatrix = {
    retirementYear,
    endOfLifeYear,
    baseAtRetirement: cellAt(baseYears, retirementYear),
    scenarioAtRetirement: cellAt(scenarioYears, retirementYear),
    baseAtEnd: cellAt(baseYears, endOfLifeYear),
    scenarioAtEnd: cellAt(scenarioYears, endOfLifeYear),
  };

  // KPIs.
  const baseEnd = liquidPortfolioTotal(baseYears[baseYears.length - 1]);
  const scnEnd = liquidPortfolioTotal(scenarioYears[scenarioYears.length - 1]);
  const baseFunded = yearsFullyFunded(baseYears);
  const scnFunded = yearsFullyFunded(scenarioYears);
  const baseTax = lifetimeTaxes(baseYears);
  const scnTax = lifetimeTaxes(scenarioYears);

  const posDeltaPts =
    baseSuccess != null && scenarioSuccess != null
      ? Math.round(scenarioSuccess * 100) - Math.round(baseSuccess * 100)
      : null;

  const kpis: ComparisonKpi[] = [
    {
      label: "Probability of Success",
      base: fmtPct(baseSuccess),
      scenario: fmtPct(scenarioSuccess),
      deltaLabel:
        posDeltaPts == null
          ? "—"
          : `${posDeltaPts >= 0 ? "+" : "−"}${Math.abs(posDeltaPts)} pts`,
      direction: posDeltaPts == null ? 0 : posDeltaPts >= 0 ? 1 : -1,
    },
    {
      label: "Ending Portfolio Assets",
      base: fmtUsdCompact(baseEnd),
      scenario: fmtUsdCompact(scnEnd),
      deltaLabel: signed(scnEnd - baseEnd, fmtUsdCompact),
      direction: scnEnd - baseEnd >= 0 ? 1 : -1,
    },
    {
      label: "Years Fully Funded",
      base: String(baseFunded),
      scenario: String(scnFunded),
      deltaLabel: `${scnFunded - baseFunded >= 0 ? "+" : "−"}${Math.abs(scnFunded - baseFunded)}`,
      direction: scnFunded - baseFunded >= 0 ? 1 : -1,
    },
    {
      label: "Lifetime Taxes",
      base: fmtUsdCompact(baseTax),
      scenario: fmtUsdCompact(scnTax),
      deltaLabel: signed(scnTax - baseTax, fmtUsdCompact),
      // Lower taxes are good → invert.
      direction: scnTax - baseTax <= 0 ? 1 : -1,
    },
  ];

  return { kpis, overlay, matrix };
}
