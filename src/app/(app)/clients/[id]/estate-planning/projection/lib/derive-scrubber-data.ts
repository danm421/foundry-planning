/**
 * Pure transform from `(tree, withResult, withoutResult, scrubberYear)` into
 * a 3-column comparison-grid data structure (`without` / `with` / `impact`)
 * consumed by `ComparisonGrid` (Task 26).
 *
 * No React, DOM, fetch, or DB — engine-adjacent helper. Lives here (and not
 * in `src/engine/`) because it formats text for the report UI; the engine
 * itself stays framework-free per AGENTS.md.
 */

import type {
  ClientData,
  ProjectionYear,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "@/lib/estate/in-estate-at-year";

export type RowSentiment = "neutral" | "pos" | "neg";

export interface CellRow {
  label: string;
  valueText: string;
  sentiment: RowSentiment;
}

export interface ScrubberCell {
  /** Column header eyebrow text (e.g. "Without plan"). */
  label: string;
  /** Pill-style sublabel (e.g. "[ILIT + SLAT]"). */
  pillLabel: string;
  /** Headline number row label (e.g. "Net to heirs"). */
  headlineLabel: string;
  /** The big rendered number — UI formats however it likes. */
  bigNumber: number;
  /** Sub-line under the headline (e.g. "at 2055"). */
  subLine: string;
  /** Four breakdown rows for the cell body. */
  rows: CellRow[];
}

export interface ScrubberData {
  without: ScrubberCell;
  with: ScrubberCell;
  impact: ScrubberCell;
}

export function deriveScrubberData(args: {
  tree: ClientData;
  withResult: ProjectionResult;
  withoutResult: ProjectionResult;
  scrubberYear: number;
}): ScrubberData {
  const { tree, withResult, withoutResult, scrubberYear } = args;
  const startYear = tree.planSettings.planStartYear;

  const withoutInEstate = sumInOutAtYear(
    tree,
    withoutResult,
    scrubberYear,
    startYear,
    "in",
  );
  const withoutOutOfEstate = sumInOutAtYear(
    tree,
    withoutResult,
    scrubberYear,
    startYear,
    "out",
  );
  const withoutGross = withoutInEstate + withoutOutOfEstate;

  const withInEstate = sumInOutAtYear(
    tree,
    withResult,
    scrubberYear,
    startYear,
    "in",
  );
  const withOutOfEstate = sumInOutAtYear(
    tree,
    withResult,
    scrubberYear,
    startYear,
    "out",
  );
  const withGross = withInEstate + withOutOfEstate;

  // Final death year drives "pre-death" gating. Estate-tax events fire only at
  // death years, so before then the totalEstateTax/admin rows display "$0
  // (pre-death)" sentinels. Use the second death event for married households,
  // first death for single filers.
  const finalDeathYear =
    withResult.secondDeathEvent?.year ??
    withResult.firstDeathEvent?.year ??
    Number.POSITIVE_INFINITY;
  const isPreDeath = scrubberYear < finalDeathYear;

  const withoutDeathYearTax = isPreDeath
    ? undefined
    : withoutResult.years[finalDeathYear - startYear]?.estateTax;
  const withDeathYearTax = isPreDeath
    ? undefined
    : withResult.years[finalDeathYear - startYear]?.estateTax;

  const withoutTax = withoutDeathYearTax?.totalEstateTax ?? 0;
  const withoutAdmin = withoutDeathYearTax?.estateAdminExpenses ?? 0;
  const withTax = withDeathYearTax?.totalEstateTax ?? 0;
  const withAdmin = withDeathYearTax?.estateAdminExpenses ?? 0;

  const withoutNetToHeirs = withoutGross - withoutTax - withoutAdmin;
  const withNetToHeirs = withGross - withTax - withAdmin;

  const taxSaved = withoutTax - withTax;

  return {
    without: {
      label: "Without plan",
      pillLabel: "[do nothing]",
      headlineLabel: "Net to heirs",
      bigNumber: withoutNetToHeirs,
      subLine: `at ${scrubberYear}`,
      rows: [
        {
          label: "Gross estate",
          valueText: formatM(withoutGross),
          sentiment: "neutral",
        },
        {
          label: "Federal + state tax",
          valueText: isPreDeath ? "$0 (pre-death)" : `−${formatM(withoutTax)}`,
          sentiment: "neg",
        },
        {
          label: "Admin & probate",
          valueText: isPreDeath ? "$0 (pre-death)" : `−${formatM(withoutAdmin)}`,
          sentiment: "neg",
        },
        {
          label: "Net to heirs",
          valueText: formatM(withoutNetToHeirs),
          sentiment: "neutral",
        },
      ],
    },
    with: {
      label: "With current plan",
      pillLabel: "[ILIT + SLAT]",
      headlineLabel: "Net to heirs",
      bigNumber: withNetToHeirs,
      subLine: `at ${scrubberYear}`,
      rows: [
        {
          label: "In-estate (taxed)",
          valueText: formatM(withInEstate),
          sentiment: "neutral",
        },
        {
          label: "Out-of-estate",
          valueText: formatM(withOutOfEstate),
          sentiment: "pos",
        },
        {
          label: "Tax on in-estate",
          valueText: isPreDeath ? "$0 (pre-death)" : `−${formatM(withTax)}`,
          sentiment: "neg",
        },
        {
          label: "Net to heirs",
          valueText: formatM(withNetToHeirs),
          sentiment: "neutral",
        },
      ],
    },
    impact: {
      label: "Plan impact",
      pillLabel: "[delta]",
      headlineLabel: "Tax saved",
      bigNumber: isPreDeath ? 0 : taxSaved,
      subLine: isPreDeath ? "—" : `at ${scrubberYear}`,
      rows: [
        {
          label: "Tax saved",
          valueText: isPreDeath ? "—" : formatM(taxSaved),
          sentiment: "pos",
        },
        {
          label: "Tax-free growth captured",
          valueText: formatM(
            taxFreeGrowthCaptured(tree, withResult, scrubberYear, startYear),
          ),
          sentiment: "pos",
        },
        {
          label: "Gift exemption used",
          valueText: pctOfFedExemption(withResult, finalDeathYear, startYear),
          sentiment: "neutral",
        },
        {
          label: "Effective rate saved",
          valueText: isPreDeath
            ? "—"
            : effectiveRateSavedPct(withoutTax, withoutGross, withTax, withGross),
          sentiment: "pos",
        },
      ],
    },
  };
}

// ---- helpers --------------------------------------------------------------

function sumInOutAtYear(
  tree: ClientData,
  result: ProjectionResult,
  year: number,
  startYear: number,
  mode: "in" | "out",
): number {
  const yearIdx = year - startYear;
  const py = result.years[yearIdx];
  if (!py) return 0;
  const accountBalances = buildAccountBalances(py);
  const fn = mode === "in" ? computeInEstateAtYear : computeOutOfEstateAtYear;
  return fn({
    tree,
    giftEvents: tree.giftEvents ?? [],
    year,
    projectionStartYear: startYear,
    accountBalances,
  });
}

/**
 * Build the year-N account-balance map from `accountLedgers.endingValue`.
 *
 * Per the Task 17 audit, `endingValue` is the canonical "year-N balance" for
 * downstream estate-math consumers. `portfolioAssets` is split into six
 * category sub-maps and so isn't a clean Record<accountId, balance>; using
 * `accountLedgers` keeps this transform aligned with the rest of the estate
 * pipeline.
 */
function buildAccountBalances(py: ProjectionYear): Map<string, number> {
  const balances = new Map<string, number>();
  for (const [accountId, ledger] of Object.entries(py.accountLedgers ?? {})) {
    balances.set(accountId, ledger.endingValue);
  }
  return balances;
}

/**
 * Coarse approximation per spec: out-of-estate(year) − Σ gift amounts (cash
 * and asset, by amount or amountOverride) made up to and including
 * `scrubberYear`. Floors at 0 so we never display a negative "growth captured."
 * Acknowledged simplification — see plan §Task 25 future-work for a
 * gift-cost-basis-aware variant.
 */
function taxFreeGrowthCaptured(
  tree: ClientData,
  withResult: ProjectionResult,
  year: number,
  startYear: number,
): number {
  const py = withResult.years[year - startYear];
  if (!py) return 0;
  const balances = buildAccountBalances(py);
  const outOfEstate = computeOutOfEstateAtYear({
    tree,
    giftEvents: tree.giftEvents ?? [],
    year,
    projectionStartYear: startYear,
    accountBalances: balances,
  });
  const giftsThroughYear = (tree.giftEvents ?? [])
    .filter((g) => g.year <= year)
    .reduce((sum, g) => {
      if (g.kind === "cash") return sum + (g.amount ?? 0);
      if (g.kind === "asset") return sum + (g.amountOverride ?? 0);
      return sum;
    }, 0);
  return Math.max(0, outOfEstate - giftsThroughYear);
}

/**
 * Federal-exemption usage as % of applicable exclusion at final death.
 *
 * Derived from the with-plan final-death `EstateTaxResult`:
 *   adjustedTaxableGifts / applicableExclusion × 100
 *
 * `applicableExclusion = beaAtDeathYear + dsueReceived` (BEA inflated to
 * death year + DSUE ported from first death). `adjustedTaxableGifts` is the
 * cumulative lifetime gifts above annual exclusions tracked by the engine.
 *
 * Returns "—" when:
 *   - no final-death event in the projection window
 *   - applicableExclusion is 0 (degenerate / pre-2026 sunset edge case)
 */
function pctOfFedExemption(
  withResult: ProjectionResult,
  finalDeathYear: number,
  startYear: number,
): string {
  if (!Number.isFinite(finalDeathYear)) return "—";
  const py = withResult.years[finalDeathYear - startYear];
  const estateTax = py?.estateTax;
  if (!estateTax) return "—";
  if (estateTax.applicableExclusion <= 0) return "—";
  const pct =
    (estateTax.adjustedTaxableGifts / estateTax.applicableExclusion) * 100;
  return `${pct.toFixed(1)}%`;
}

function effectiveRateSavedPct(
  withoutTax: number,
  withoutGross: number,
  withTax: number,
  withGross: number,
): string {
  if (withoutGross === 0 || withGross === 0) return "—";
  const pct = (withoutTax / withoutGross - withTax / withGross) * 100;
  return `${pct.toFixed(1)}pts`;
}

function formatM(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
