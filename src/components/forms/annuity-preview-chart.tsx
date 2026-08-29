"use client";

import { useMemo, type ReactNode } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { Line } from "react-chartjs-2";
import { initAnnuityState, stepAnnuityYear } from "@/engine/annuity";
import type { AnnuityContract } from "@/engine/annuity";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import { FieldTooltip } from "./field-tooltip";

/**
 * The picture at the bottom of "Income & Guarantees": where the account balance
 * runs out while the guaranteed income keeps paying.
 *
 * Read-only by design — it takes props, runs the annuity engine over them, and
 * draws. It never fetches and never calls the panel's `onChange`.
 */

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  annotationPlugin,
);

/** The projection runs to this age, so the picture ends where a plan ends
 *  rather than after an arbitrary count of years. */
const PREVIEW_END_AGE = 95;

/** Illustration growth. The panel has no growth assumption of its own, so this
 *  is a stated, disclosed number rather than a borrowed one — the contract's
 *  own fee is subtracted from it by the engine. */
const PREVIEW_GROWTH_RATE = 0.04;

export interface PreviewRow {
  year: number;
  accountValue: number;
  benefitBase: number;
  income: number;
  /** First year the account value is exhausted while income continues. */
  isCrossover: boolean;
}

export interface AnnuityPreviewInput {
  contract: AnnuityContract;
  accountValue: number;
  startYear: number;
  years: number;
  ownerAgeAtStart: number;
  growthRate: number;
}

/**
 * Runs the contract forward one year at a time and records what an advisor
 * needs to see: the balance, the guaranteed base, and the cash paid out.
 *
 * `isAlive` is always true here. A preview illustrates a living owner; the
 * survivor and death rules belong to the real projection, which knows when
 * anyone dies. A form panel does not.
 */
export function buildAnnuityPreviewRows(input: AnnuityPreviewInput): PreviewRow[] {
  const { contract, accountValue, startYear, years, ownerAgeAtStart, growthRate } = input;
  let state = initAnnuityState(contract, accountValue);
  const rows: PreviewRow[] = [];
  let crossed = false;

  for (let i = 0; i < years; i++) {
    const result = stepAnnuityYear({
      contract,
      state,
      year: startYear + i,
      ownerAge: ownerAgeAtStart + i,
      growthRate,
      isAlive: true,
    });
    state = result.state;
    // The crossover: the contract's own value is gone and the carrier is paying
    // out of its own pocket. Only the FIRST such year is marked — every year
    // after it has a zero balance too, and three flags would draw three lines.
    const isCrossover = !crossed && state.accountValue <= 0 && result.income > 0;
    if (isCrossover) crossed = true;
    rows.push({
      year: startYear + i,
      accountValue: state.accountValue,
      benefitBase: state.benefitBase,
      income: result.income,
      isCrossover,
    });
  }
  return rows;
}

/**
 * The owner's age when the preview starts, or `null` when it cannot be known.
 *
 * A missing birth year must stop the preview, not be papered over. Without a
 * real age the engine's `payoutPercentForAge(NaN)` neither throws nor returns
 * zero — every `NaN >= band.minAge` is false, so it falls through and hands
 * back the LAST band's percent. The chart would then draw a confident income
 * line off a number nobody entered, and nothing anywhere would complain.
 */
export function annuityPreviewAgeAtStart(
  startYear: number,
  ownerBirthYear: number | null | undefined,
): number | null {
  if (ownerBirthYear == null || !Number.isFinite(ownerBirthYear)) return null;
  return startYear - ownerBirthYear;
}

export interface AnnuityPreviewChartProps {
  contract: AnnuityContract;
  /** The account's balance today. `null` when the advisor hasn't entered one. */
  accountValue: number | null;
  startYear: number;
  /** The owner's age in `startYear`, or `null` when there is no birth year. */
  ownerAgeAtStart: number | null;
  /** Defaults to running out to age 95. */
  years?: number;
  growthRate?: number;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** What one render of the preview has to say. The two non-`ok` arms are the
 *  renders where no rows exist, which is why they live inside the same memo as
 *  the rows themselves rather than in early returns above it. */
type PreviewState =
  | { kind: "missing"; missing: string[] }
  | { kind: "failed"; isRateGuard: boolean }
  | { kind: "ok"; rows: PreviewRow[] };

/**
 * Two blues would be indistinguishable and purple beside blue is a known
 * colour-blind failure in this palette; blue / orange / green measures at worst
 * 49.3 ΔE76 under simulated deuteranopia, well over the floor of 20. Each line
 * also carries its own dash, so identity is never colour alone.
 */
function buildChartData(
  rows: PreviewRow[],
  palette: ReturnType<typeof dataPalette>,
  chrome: ReturnType<typeof chartChrome>,
  incomeMode: AnnuityContract["incomeMode"],
): ChartData<"line"> {
  const balance = {
    label: "Balance",
    data: rows.map((r) => r.accountValue),
    borderColor: palette.blue,
    backgroundColor: palette.blue,
    borderWidth: 2,
    // The crossover year is the only marked point on the chart, ringed in the
    // surface colour so it reads as a marker rather than a kink in the line.
    pointRadius: rows.map((r) => (r.isCrossover ? 4 : 0)),
    pointBackgroundColor: palette.blue,
    pointBorderColor: chrome.tooltipBg,
    pointBorderWidth: 2,
    tension: 0.2,
  };
  const guaranteedBase = {
    label: "Guaranteed base",
    data: rows.map((r) => r.benefitBase),
    borderColor: palette.orange,
    backgroundColor: palette.orange,
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    tension: 0.2,
  };
  const income = {
    label: "Income each year",
    data: rows.map((r) => r.income),
    borderColor: palette.green,
    backgroundColor: palette.green,
    borderWidth: 2,
    borderDash: [2, 3],
    pointRadius: 0,
    tension: 0.2,
  };

  return {
    labels: rows.map((r) => String(r.year)),
    datasets: [
      balance,
      // The guaranteed base only moves on a rider. An annuitized contract has
      // no rollup, so the line would be a flat, meaningless third series.
      ...(incomeMode === "rider" ? [guaranteedBase] : []),
      income,
    ],
  };
}

/** `crossoverIndex` is -1 when there is no crossover, which is also what
 *  suppresses the annotation. */
function buildChartOptions(
  chrome: ReturnType<typeof chartChrome>,
  crossoverIndex: number,
  annuitized: boolean,
): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { color: chrome.legend, boxWidth: 24 } },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${usd.format((ctx.parsed.y as number) ?? 0)}`,
        },
      },
      annotation:
        crossoverIndex >= 0
          ? {
              annotations: {
                crossover: {
                  type: "line" as const,
                  xMin: crossoverIndex,
                  xMax: crossoverIndex,
                  borderColor: chrome.grid,
                  borderWidth: 1,
                  borderDash: [4, 4],
                  label: {
                    display: true,
                    content: annuitized ? "Payments start" : "Balance gone",
                    position: "start" as const,
                    backgroundColor: chrome.tooltipBg,
                    color: chrome.tick,
                    font: { size: 10 },
                  },
                },
              },
            }
          : undefined,
    },
    scales: {
      x: { ticks: { color: chrome.tick, maxTicksLimit: 10 }, grid: { color: chrome.grid } },
      y: {
        beginAtZero: true,
        ticks: { color: chrome.tick, callback: (v) => `$${Math.round(Number(v) / 1000)}k` },
        grid: { color: chrome.grid },
      },
    },
  };
}

/** 0.045 -> "4.5%". Rounded because 0.07 * 100 is 7.000000000000001. */
function formatPct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

const NOTE_CLASS = "text-[11px] leading-snug text-ink-3";

/** The heading stays put whether or not there is a picture under it, so the
 *  panel does not grow and shrink as the advisor fills the contract in. */
function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-hair p-4">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-ink">Balance and income over time</h3>
        {/* The growth assumption is NOT in here — it decides the year printed on
            the chart face, so it is printed there too. This carries only what
            does not change a number. */}
        <FieldTooltip text="An illustration, not a quote. It runs the contract exactly as entered above, applies the contract's own fees to the growth, and assumes the owner is living throughout. Change a number above and the picture changes." />
      </div>
      {children}
    </section>
  );
}

/** "a", "a and b", "a, b, and c". */
function andList(parts: string[]): string {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function AnnuityPreviewChart({
  contract,
  accountValue,
  startYear,
  ownerAgeAtStart,
  years,
  growthRate,
}: AnnuityPreviewChartProps) {
  const theme = useThemeName();
  // Kept apart so the face can say WHICH rate it drew: the account's own, or
  // this module's illustration rate standing in for one.
  const rate = growthRate ?? PREVIEW_GROWTH_RATE;
  const rateIsTheAccounts = growthRate != null;

  // EVERY hook runs before the first early return below — the guard cases are
  // exactly the renders where `rows` cannot be built, so folding them into the
  // memo is what keeps hook order legal.
  const preview = useMemo((): PreviewState => {
    // Refuse to guess. An invented age, an invented balance, or an income start
    // that never resolved all draw a picture that looks right and is not.
    const missing: string[] = [];
    if (accountValue == null) missing.push("the account balance");
    if (ownerAgeAtStart == null) missing.push("the owner's date of birth");
    if (contract.incomeMode !== "none" && contract.incomeStartYear == null) {
      missing.push("the year income starts");
    }
    if (accountValue == null || ownerAgeAtStart == null || missing.length > 0) {
      return { kind: "missing", missing };
    }

    try {
      return {
        kind: "ok",
        rows: buildAnnuityPreviewRows({
          contract,
          accountValue,
          startYear,
          years: years ?? Math.max(10, PREVIEW_END_AGE - ownerAgeAtStart),
          ownerAgeAtStart,
          growthRate: rate,
        }),
      };
    } catch (err) {
      // The engine rejects a rate outside 0-100%, and this panel emits one on
      // every keystroke of "150", so a half-typed percentage must not
      // white-screen the form it is being typed into. But that is the ONLY
      // throw we can name: `src/engine/annuity/rates.ts` has no error class, so
      // its two messages are the only handle, and anything else is a bug that
      // must not be reported to the advisor as percentages they need to go and
      // fix.
      const message = err instanceof Error ? err.message : String(err);
      const isRateGuard = /out of \[0,1\]|is not a finite rate/.test(message);
      if (!isRateGuard) console.warn("Annuity preview could not be drawn:", err);
      return { kind: "failed", isRateGuard };
    }
  }, [contract, accountValue, startYear, years, ownerAgeAtStart, rate]);

  // `dataPalette` returns one of two module-level constants, so it is already
  // referentially stable per theme. `chartChrome` BUILDS A FRESH OBJECT every
  // call, so it has to be memoized here — used raw it would bust both memos
  // below on every render and defeat the whole point of them.
  const palette = dataPalette(theme);
  const chrome = useMemo(() => chartChrome(theme), [theme]);

  // `data` and `options` are memoized because react-chartjs-2 keys its update
  // effects on exactly these identities (`[redraw, options]`,
  // `[redraw, data.labels]`, `[redraw, data.datasets]`). Rebuilt fresh, all
  // three fire on EVERY render and end in `chart.update()` — a scale re-fit and
  // a restarted 1s animation. This panel stays mounted (hidden) while the
  // advisor is on the Details tab, so without this, typing the account name or
  // balance drives a full chart update per keystroke on an invisible canvas.
  const chartData = useMemo((): ChartData<"line"> | null => {
    if (preview.kind !== "ok") return null;
    return buildChartData(preview.rows, palette, chrome, contract.incomeMode);
  }, [preview, palette, chrome, contract.incomeMode]);

  const options = useMemo((): ChartOptions<"line"> | null => {
    if (preview.kind !== "ok") return null;
    return buildChartOptions(
      chrome,
      preview.rows.findIndex((r) => r.isCrossover),
      contract.incomeMode === "annuitized",
    );
  }, [preview, chrome, contract.incomeMode]);

  if (preview.kind === "missing") {
    return (
      <PreviewFrame>
        <p className={NOTE_CLASS}>Add {andList(preview.missing)} to preview this contract.</p>
      </PreviewFrame>
    );
  }

  if (preview.kind === "failed") {
    return (
      <PreviewFrame>
        <p className={NOTE_CLASS}>
          {preview.isRateGuard
            ? "Check the percentages above — one of them is outside 0–100%."
            : "This contract could not be previewed."}
        </p>
      </PreviewFrame>
    );
  }

  const rows = preview.rows;
  const crossoverIndex = rows.findIndex((r) => r.isCrossover);
  const crossover = crossoverIndex >= 0 ? rows[crossoverIndex] : null;
  const lastYear = rows[rows.length - 1].year;

  const annuitized = contract.incomeMode === "annuitized";
  const terminalBalance = rows[rows.length - 1].accountValue;
  const firstEmpty = rows.find((r) => r.accountValue <= 0);

  // Split so the year can wear the numeral mono the brand requires, without a
  // second copy of the sentence drifting out of step with the screen reader's.
  //
  // Three different things can be true at the end of the run:
  //  · the balance emptied while the payments carried on — the crossover;
  //  · it never emptied;
  //  · it emptied and nothing is being paid, because income has not started
  //    (or never will inside the horizon). That last one used to be reported as
  //    "still has money in it", asserted purely from the ABSENCE of a crossover
  //    flag, printing a positive claim over a line sitting on zero.
  const finding = crossover
    ? annuitized
      // Annuitizing SURRENDERS the balance in exchange for the payments — the
      // advisor's own deliberate act, already warned about further up this
      // panel. Calling it "the balance is gone" raises an alarm for a non-event.
      ? {
          lead: "The payments start in ",
          year: crossover.year,
          tail: " — the balance goes to the carrier in exchange for them.",
        }
      : {
          lead: "The balance is gone from ",
          year: crossover.year,
          tail: " — the guaranteed income keeps paying.",
        }
    : terminalBalance > 0
      ? { lead: "The balance still has money in it in ", year: lastYear, tail: "." }
      : {
          lead: "The balance runs out in ",
          year: (firstEmpty ?? rows[rows.length - 1]).year,
          tail: ", and no income is being paid.",
        };
  const findingText = `${finding.lead}${finding.year}${finding.tail}`;

  const assumption = rateIsTheAccounts
    ? { lead: "Assumes this account's growth rate of ", pct: formatPct(rate), tail: " a year." }
    : {
        lead: "Assumes ",
        pct: formatPct(rate),
        tail: " growth a year — an illustration rate, not this account's.",
      };
  const assumptionText = `${assumption.lead}${assumption.pct}${assumption.tail}`;

  return (
    <PreviewFrame>
      <div className="space-y-0.5">
        <p className={NOTE_CLASS}>
          {finding.lead}
          <span className="tabular">{finding.year}</span>
          {finding.tail}
        </p>
        {/* On the face, not in the tooltip: this rate decides the year printed
            in the sentence above it. */}
        <p className={NOTE_CLASS}>
          {assumption.lead}
          <span className="tabular">{assumption.pct}</span>
          {assumption.tail}
        </p>
      </div>
      <div className="h-64 w-full">
        <Line
          data={chartData!}
          options={options!}
          role="img"
          aria-label={`Balance and guaranteed income from ${rows[0].year} to ${lastYear}. ${findingText} ${assumptionText}`}
        />
      </div>
    </PreviewFrame>
  );
}
