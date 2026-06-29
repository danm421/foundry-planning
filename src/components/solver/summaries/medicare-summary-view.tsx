"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { MedicareSummaryPageData } from "@/lib/presentations/pages/medicare-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/medicare-summary/aggregate";
import type { MedicareYearBar, MedicareComposition } from "@/lib/presentations/pages/medicare-summary/aggregate";
import { chartChrome, dataPalette, statusColors, useThemeName } from "@/lib/chart-colors";
import {
  SummaryLayout,
  SummarySection,
  SummaryKpiRow,
  SummaryKpiCard,
  SummaryTable,
  SummaryNarrative,
  SummaryEmpty,
} from "./primitives";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Stacked "Annual Medicare cost" chart ──────────────────────────────────────
// Two stacked series: base premiums (Part B + Part D + Medigap) and IRMAA.
// IRMAA uses the semantic status color (crit) — accessed via statusColors(),
// not dataPalette(), since "crit" is not a DataColorKey.
function MedicareYearsChart({ bars }: { bars: MedicareYearBar[] }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (bars.length === 0) return null;
    const palette = dataPalette(theme);
    const status = statusColors(theme);
    return {
      labels: bars.map((b) => String(b.year)),
      datasets: [
        {
          label: "Base premiums",
          data: bars.map((b) => b.base),
          backgroundColor: palette.blue,
          stack: "medicare",
        },
        {
          label: "IRMAA surcharge",
          data: bars.map((b) => b.irmaa),
          backgroundColor: status.crit,
          stack: "medicare",
        },
      ],
    };
  }, [bars, theme]);

  const options = useMemo<ChartOptions<"bar">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: chrome.legend, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${fmtUsd(Number(ctx.parsed.y ?? 0))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          stacked: true,
          ticks: {
            color: chrome.tick,
            callback: (v: unknown) => fmtUsd(Number(v)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);

  if (!chartData) return null;
  return (
    <div className="h-[280px]">
      <Bar data={chartData} options={options} />
    </div>
  );
}

// ── Composition split bar + table ─────────────────────────────────────────────
// "irmaa" uses statusColors.crit (semantic danger) rather than a DataColorKey,
// so we resolve its hex separately and pass it as a plain string.
interface CompSegment {
  key: keyof Pick<MedicareComposition, "partB" | "partD" | "medigap" | "irmaa">;
  label: string;
}
const COMP_SEGMENTS: CompSegment[] = [
  { key: "partB", label: "Part B" },
  { key: "partD", label: "Part D" },
  { key: "medigap", label: "Medigap" },
  { key: "irmaa", label: "IRMAA" },
];

function CompositionSection({
  composition,
  theme,
}: {
  composition: MedicareComposition;
  theme: ReturnType<typeof useThemeName>;
}) {
  const palette = dataPalette(theme);
  const status = statusColors(theme);
  const total = composition.total;

  // Map each segment key to its resolved color hex
  const segColors: Record<CompSegment["key"], string> = {
    partB: palette.blue,
    partD: palette.teal,
    medigap: palette.green,
    irmaa: status.crit,
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Split bar */}
      <div className="flex h-4 overflow-hidden rounded">
        {COMP_SEGMENTS.map((seg) => {
          const v = composition[seg.key];
          const pct = total > 0 ? (v / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, backgroundColor: segColors[seg.key] }}
            />
          );
        })}
      </div>
      {/* Composition table */}
      <SummaryTable
        columns={[
          { key: "label", header: "Component" },
          { key: "pct", header: "Share", align: "right" },
          { key: "amount", header: "Lifetime cost", align: "right" },
        ]}
        rows={[
          ...COMP_SEGMENTS.map((seg) => {
            const v = composition[seg.key];
            const pct = total > 0 ? Math.round((v / total) * 100) : 0;
            return {
              label: (
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: segColors[seg.key] }}
                  />
                  {seg.label}
                </span>
              ),
              pct: `${pct}%`,
              amount: fmtUsd(v),
            };
          }),
          {
            label: <span className="font-semibold text-ink">Total</span>,
            pct: "",
            amount: (
              <span className="font-semibold text-ink">{fmtUsd(total)}</span>
            ),
          },
        ]}
      />
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────
const DISCLAIMER =
  "Medicare premiums and IRMAA use CMS current-year amounts inflated forward; thresholds are CPI-indexed and reflect MAGI from two years prior. Excludes IRMAA appeals (life-changing events), Medicaid interactions, and Part D formulary effects. Actual costs vary by plan and CMS rule changes.";

export function MedicareSummaryView({
  data,
}: {
  data: MedicareSummaryPageData;
}) {
  const theme = useThemeName();

  if (data.isEmpty) {
    return <SummaryEmpty message="No data for this scenario yet." />;
  }

  const { kpis, bars, composition, tierLadder, headroom, enrollment } = data;

  // Peak tier label
  const peakTierLabel =
    kpis.peakTierYear != null
      ? `Tier ${kpis.peakTier} · ${kpis.peakTierYear}`
      : "None";

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      {/* KPI row */}
      <SummaryKpiRow>
        <SummaryKpiCard
          label="Lifetime Medicare Cost"
          value={fmtUsd(kpis.lifetimeMedicareCost)}
        />
        <SummaryKpiCard
          label="Lifetime IRMAA Surcharge"
          value={fmtUsd(kpis.lifetimeIrmaa)}
        />
        <SummaryKpiCard
          label="IRMAA Share of Medicare"
          value={fmtPct(kpis.irmaaShare)}
        />
        <SummaryKpiCard
          label="Years in IRMAA"
          value={`${kpis.irmaaYears} of ${kpis.enrolledYears}`}
        />
        <SummaryKpiCard label="Peak IRMAA Tier" value={peakTierLabel} />
      </SummaryKpiRow>

      {/* Annual cost chart */}
      <SummarySection heading="Annual Medicare cost — base premiums vs. IRMAA">
        <div className="rounded-lg border border-hair bg-card-2 p-4">
          <MedicareYearsChart bars={bars} />
        </div>
      </SummarySection>

      {/* Two-column lower body: composition + tier ladder */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Lifetime composition */}
        <SummarySection heading="Where the money goes (lifetime)">
          <CompositionSection composition={composition} theme={theme} />
        </SummarySection>

        {/* IRMAA tier exposure */}
        <SummarySection heading="IRMAA tier exposure">
          <SummaryTable
            columns={[
              { key: "tier", header: "Tier" },
              { key: "threshold", header: "MAGI threshold" },
              { key: "years", header: "Years", align: "right" },
            ]}
            rows={tierLadder.map((row) => ({
              tier: `Tier ${row.tier}`,
              threshold: row.thresholdLabel ?? "—",
              years: `${row.years} yr${row.years === 1 ? "" : "s"}`,
            }))}
          />
          {/* Headroom callout — only when present */}
          {headroom ? (
            <p className="mt-1 text-[12px] text-ink-3">
              In {headroom.year},{" "}
              <span className="tabular-nums">{fmtUsd(headroom.amount)}</span>{" "}
              under the Tier {headroom.nextTier} threshold.
            </p>
          ) : null}
        </SummarySection>
      </div>

      {/* Enrollment notes — only when at least one is present */}
      {(enrollment.client ?? enrollment.spouse) ? (
        <SummarySection heading="Enrollment">
          <SummaryTable
            columns={[
              { key: "member", header: "Member" },
              { key: "year", header: "Enrollment year", align: "right" },
              { key: "age", header: "Age at enrollment", align: "right" },
            ]}
            rows={[
              ...(enrollment.client
                ? [
                    {
                      member: "Client",
                      year: String(enrollment.client.year),
                      age: String(enrollment.client.age),
                    },
                  ]
                : []),
              ...(enrollment.spouse
                ? [
                    {
                      member: "Spouse",
                      year: String(enrollment.spouse.year),
                      age: String(enrollment.spouse.age),
                    },
                  ]
                : []),
            ]}
          />
        </SummarySection>
      ) : null}

      {/* Narrative */}
      <SummaryNarrative items={data.narrative} />

      {/* Disclaimer */}
      <p className="text-[11px] text-ink-3">{DISCLAIMER}</p>
    </SummaryLayout>
  );
}
