"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import type {
  EstateTaxResult,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { TimePeriodButtons } from "./report-controls/time-period-buttons";
import type { OwnerDobs } from "./report-controls/age-helpers";
import type { EstateColumnReady } from "./estate-compare-shell";
import { useEstateColumnReady } from "@/hooks/use-estate-column-ready";
import { EstateDeltaChip, EstateRowMarker } from "./estate-delta-chip";
import {
  diffEstateTax,
  grossEstateLineKeys,
  type LineStatus,
} from "@/lib/estate/diff-estate-tax";
import { BASE_REF, readCompareSelection } from "@/lib/estate/compare-ref";
import EstateTaxSkeleton from "@/app/(app)/clients/[id]/estate-planning/estate-tax/loading-skeleton";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

type Ordering = "primaryFirst" | "spouseFirst";

interface EstateTaxReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;

  // ── Compare mode (EstateCompareShell) ──
  // All optional: with none supplied the view behaves exactly as it did before
  // the shell existed. Supplying `asOf` is what hands the controls to the shell.
  /** Overrides `?scenario=`; the right column needs its own ref. */
  scenarioRef?: string;
  asOf?: AsOfValue;
  ordering?: Ordering;
  /** Reports this column's projection metadata and first-death result upward. */
  onReady?: (ready: EstateColumnReady<EstateTaxResult>) => void;
  /** The other column's first-death result; its presence switches on deltas. */
  baseline?: EstateTaxResult | null;
}

export default function EstateTaxReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
  scenarioRef,
  asOf,
  ordering: orderingProp,
  onReady,
  baseline = null,
}: EstateTaxReportViewProps) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [ownAsOf, setOwnAsOf] = useState<AsOfValue>("today");
  const [ownOrdering, setOwnOrdering] = useState<Ordering>("primaryFirst");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedAsOf = asOf ?? ownAsOf;
  const ordering = orderingProp ?? ownOrdering;
  /** The shell renders one control row for both columns; a column renders none. */
  const showOwnControls = asOf === undefined;

  // The shell supplies its column's ref; standalone, the URL's left ref is read
  // by the same helper the shell uses, so "what an absent `?scenario=` means"
  // has exactly one definition.
  const resolvedScenarioRef =
    scenarioRef ?? readCompareSelection(searchParams).left;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url =
          resolvedScenarioRef === BASE_REF
            ? `/api/clients/${clientId}/projection-data`
            : `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(resolvedScenarioRef)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setProjection(result);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load projection data",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // Keyed on the resolved ref, never on `searchParams`: that object is fresh
    // whenever ANY param changes, so toggling `?compare=` would refetch both
    // columns against a 30/min/firm rate limit.
  }, [clientId, resolvedScenarioRef]);

  const projectionYears = useMemo(() => projection?.years ?? [], [projection]);
  const todayYear = projectionYears[0]?.year;
  const firstDeathYear = projection?.firstDeathEvent?.year;
  const secondDeathYear = projection?.secondDeathEvent?.year;
  const lastDeathYear = secondDeathYear ?? firstDeathYear;

  /**
   * Resolve which year the dropdown/buttons want to inspect for hypothetical mode.
   * "today"  → first projection year.
   * "split"  → not a single year; handled separately below.
   * number   → that year.
   */
  const resolvedYear: number | null =
    selectedAsOf === "today"
      ? (todayYear ?? null)
      : selectedAsOf === "split"
        ? null
        : selectedAsOf;

  const selectedProjectionYear = useMemo(() => {
    if (resolvedYear == null) return null;
    return projectionYears.find((y) => y.year === resolvedYear) ?? null;
  }, [projectionYears, resolvedYear]);

  // "Today" pulls the BoY-of-planStartYear hypothetical so the gross-estate
  // line items match the Balance Sheet's Today view (advisor-entered balances).
  // Future years use the per-year EoY hypothetical attached to that year row.
  const hypothetical =
    selectedAsOf === "today"
      ? projection?.todayHypotheticalEstateTax ?? null
      : selectedProjectionYear?.hypotheticalEstateTax ?? null;

  // Split death: render decedents at their actual projected death years.
  const isSplit = selectedAsOf === "split";
  const splitFirst = isSplit ? projection?.firstDeathEvent ?? null : null;
  const splitSecond = isSplit ? projection?.secondDeathEvent ?? null : null;

  // ── Active orderings ──
  const activeOrdering =
    !isSplit && hypothetical
      ? ordering === "spouseFirst" && hypothetical.spouseFirst
        ? hypothetical.spouseFirst
        : hypothetical.primaryFirst
      : null;

  // The one result the two columns align on: the first death's breakdown.
  // Every reference here points into `projection`, so the identity is stable
  // between renders — the shell compares `data` by identity.
  const reportedTax = isSplit ? splitFirst : activeOrdering?.firstDeath ?? null;

  useEstateColumnReady(projection, reportedTax, onReady);

  if (loadError) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-4 text-red-200">
        Failed to load projection: {loadError}
      </div>
    );
  }

  if (loading) {
    return <EstateTaxSkeleton />;
  }

  if (projectionYears.length === 0 || todayYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  if (!isSplit && !hypothetical) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No estate tax snapshot available for {resolvedYear}.
      </div>
    );
  }

  const milestones = [
    { year: retirementYear, label: "Retirement" },
    ...(firstDeathYear != null ? [{ year: firstDeathYear, label: "First Death" }] : []),
    ...(secondDeathYear != null ? [{ year: secondDeathYear, label: "Last Death" }] : []),
  ];

  const dropdownYears = projectionYears.map((y) => y.year);

  const firstDecedent = isSplit
    ? splitFirst?.deceased ?? null
    : activeOrdering?.firstDecedent ?? null;
  const firstDecedentName =
    firstDecedent === "client"
      ? ownerNames.clientName
      : firstDecedent === "spouse"
        ? ownerNames.spouseName ?? CO_CLIENT_LABEL
        : null;
  const survivorName =
    firstDecedent === "client"
      ? ownerNames.spouseName ?? CO_CLIENT_LABEL
      : firstDecedent === "spouse"
        ? ownerNames.clientName
        : null;

  // ── Header text ──
  const headerNote = (() => {
    if (isSplit) {
      const parts: string[] = [];
      if (splitFirst) parts.push(`${ownerForName(splitFirst, ownerNames)} dies in ${splitFirst.year}`);
      if (splitSecond) parts.push(`${ownerForName(splitSecond, ownerNames)} dies in ${splitSecond.year}`);
      return `Each decedent valued at their projected death year. ${parts.join(" · ")}.`;
    }
    if (isMarried) return `Assumes both clients die in ${resolvedYear}. Hypothetical only.`;
    return `Assumes ${firstDecedentName} dies in ${resolvedYear}. Hypothetical only.`;
  })();

  return (
    <div className="space-y-4 pt-4">
      {showOwnControls && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TimePeriodButtons
            selected={selectedAsOf}
            onChange={setOwnAsOf}
            todayYear={todayYear}
            retirementYear={retirementYear}
            firstDeathYear={firstDeathYear}
            lastDeathYear={lastDeathYear}
            showSplit={isMarried && firstDeathYear != null && secondDeathYear != null}
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-300">
              As of
              <AsOfDropdown
                years={dropdownYears}
                todayYear={todayYear}
                selected={selectedAsOf}
                onChange={setOwnAsOf}
                dobs={ownerDobs}
                milestones={milestones}
                allowSplit={isMarried && firstDeathYear != null && secondDeathYear != null}
                yearPrefix="Both die in"
              />
            </label>
            {isMarried && !isSplit && (
              <div className="inline-flex rounded border border-gray-700 bg-gray-900 p-0.5 text-sm">
                <button
                  type="button"
                  className={
                    ordering === "primaryFirst"
                      ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                      : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"
                  }
                  onClick={() => setOwnOrdering("primaryFirst")}
                >
                  {ownerNames.clientName} dies first
                </button>
                <button
                  type="button"
                  className={
                    ordering === "spouseFirst"
                      ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                      : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"
                  }
                  onClick={() => setOwnOrdering("spouseFirst")}
                >
                  {ownerNames.spouseName ?? CO_CLIENT_LABEL} dies first
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">{headerNote}</p>

      {isSplit ? (
        <>
          {splitFirst && (
            <DecedentBreakdown
              heading={`${ownerForName(splitFirst, ownerNames)} — First to die · ${splitFirst.year}`}
              tax={splitFirst}
              baseline={baseline}
              showDsueGenerated={isMarried}
            />
          )}
          {splitSecond && (
            <DecedentBreakdown
              heading={`${ownerForName(splitSecond, ownerNames)} — Second to die · ${splitSecond.year}`}
              tax={splitSecond}
              showDsueGenerated={false}
            />
          )}
          {splitFirst && splitSecond && (
            <SplitTotals first={splitFirst} second={splitSecond} />
          )}
        </>
      ) : (
        activeOrdering && (
          <>
            <DecedentBreakdown
              heading={`${firstDecedentName} — ${isMarried ? "First to die" : `Hypothetical death in ${resolvedYear}`}`}
              tax={activeOrdering.firstDeath}
              baseline={baseline}
              showDsueGenerated={isMarried}
            />
            {isMarried && activeOrdering.finalDeath && survivorName && (
              <DecedentBreakdown
                heading={`${survivorName} — Second to die`}
                tax={activeOrdering.finalDeath}
                showDsueGenerated={false}
              />
            )}
            {isMarried && activeOrdering.finalDeath && (
              <GrandTotals ordering={activeOrdering} />
            )}
          </>
        )
      )}
    </div>
  );
}

function ownerForName(
  result: EstateTaxResult,
  names: { clientName: string; spouseName: string | null },
): string {
  return result.deceased === "client" ? names.clientName : names.spouseName ?? CO_CLIENT_LABEL;
}

function formatAmount(amount: number, opts: { negate?: boolean } = {}): string {
  const n = opts.negate ? -amount : amount;
  return n < 0 ? `(${fmt.format(-n)})` : fmt.format(n);
}

function LineRow({
  label,
  amount,
  hint,
  badge,
  status,
  muted = false,
  showAsDeduction = false,
  hideIfZero = false,
}: {
  label: string;
  amount: number;
  hint?: string;
  badge?: string;
  /** Compare mode: marks a row only one of the two scenarios has. */
  status?: LineStatus;
  muted?: boolean;
  showAsDeduction?: boolean;
  hideIfZero?: boolean;
}) {
  if (hideIfZero && amount === 0) return null;
  const value = showAsDeduction
    ? amount === 0
      ? fmt.format(0)
      : `(${fmt.format(amount)})`
    : formatAmount(amount);
  const negative = showAsDeduction && amount > 0;
  return (
    <div
      className={
        "flex items-baseline justify-between gap-4 py-1 text-sm " +
        (muted ? "text-gray-500" : "text-gray-300")
      }
    >
      <span className="min-w-0 break-words">
        {label}
        {badge && (
          <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/90">
            {badge}
          </span>
        )}
        {hint && <span className="ml-2 text-xs text-gray-500">{hint}</span>}
        {/* `empty:hidden` drops the gap on rows the marker renders nothing for. */}
        {status && (
          <span className="ml-2 empty:hidden">
            <EstateRowMarker status={status} />
          </span>
        )}
      </span>
      <span
        className={
          "shrink-0 tabular-nums " +
          (negative ? "text-rose-300/90" : muted ? "text-gray-500" : "text-gray-200")
        }
      >
        {value}
      </span>
    </div>
  );
}

type SubtotalAccent = "neutral" | "primary" | "tax";

function Section({
  title,
  subtotal,
  subtotalLabel,
  subtotalAccent = "primary",
  delta,
  deltaTestId,
  children,
}: {
  title: string;
  subtotal: number;
  subtotalLabel: string;
  subtotalAccent?: SubtotalAccent;
  /** Compare mode: this subtotal's change against the other column. */
  delta?: number | null;
  deltaTestId?: string;
  children: React.ReactNode;
}) {
  const accentClass =
    subtotalAccent === "tax"
      ? subtotal > 0
        ? "text-rose-200"
        : "text-emerald-200"
      : "text-gray-50";
  return (
    <div className="px-5 py-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-200">
        {title}
      </h3>
      <div>{children}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-gray-800/80 pt-1.5">
        <span className={"text-sm font-medium " + accentClass}>
          {subtotalLabel}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {delta != null && (
            // Every subtotal here is a death tax or the base one is charged
            // on, so a fall is the good news in all of them.
            <EstateDeltaChip
              delta={delta}
              goodDirection="down"
              testId={deltaTestId}
            />
          )}
          <span
            className={
              "text-base font-semibold tabular-nums " + accentClass
            }
          >
            {formatAmount(subtotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

function DecedentBreakdown({
  heading,
  tax,
  baseline = null,
  showDsueGenerated,
}: {
  heading: string;
  tax: EstateTaxResult;
  /** The other column's result for this same death; null outside compare mode. */
  baseline?: EstateTaxResult | null;
  showDsueGenerated: boolean;
}) {
  const irdTotal = irdTaxOf(tax);
  const stateInheritanceTax = inheritanceTaxOf(tax);
  const totalTaxesAndExpenses = displayedTotalTaxesAndExpenses(tax);
  const headlineColor =
    totalTaxesAndExpenses > 0 ? "text-rose-200" : "text-emerald-200";

  const diff = baseline ? diffEstateTax(baseline, tax) : null;
  const lineKeys = grossEstateLineKeys(tax.grossEstateLines);
  // An asset the other scenario holds and this one does not still gets a row,
  // at $0 — otherwise "gifted the business out of the estate" reads as a line
  // that was never there, and `removed` is unreachable in this view.
  const removedLines = baseline
    ? grossEstateLineKeys(baseline.grossEstateLines)
        .map((key, i) => ({ key, label: baseline.grossEstateLines[i].label }))
        .filter(({ key }) => diff?.lines.get(key)?.status === "removed")
    : [];
  // The engine's `totalTaxesAndExpenses` omits state inheritance and IRD tax,
  // which this card adds in — so this delta is computed the same way the
  // figure beside it is, never read off `diff.totals`.
  const totalDelta = baseline
    ? totalTaxesAndExpenses - displayedTotalTaxesAndExpenses(baseline)
    : null;

  const showTentativeBase = tax.adjustedTaxableGifts > 0;
  const unifiedCreditHint = `(${fmt.format(tax.beaAtDeathYear)} Basic Exclusion + ${fmt.format(tax.dsueReceived)} DSUE)`;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="border-b border-gray-800 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
              Total Taxes &amp; Expenses
            </span>
            <span
              className={
                "text-xl font-semibold tabular-nums " + headlineColor
              }
            >
              {fmt.format(totalTaxesAndExpenses)}
            </span>
          </div>
        </div>
      </header>

      {tax.grossEstate < 0 && (
        <div className="border-b border-amber-900/40 bg-amber-950/30 px-5 py-2 text-xs text-amber-200/90">
          Gross estate is negative because attributed household debt exceeds
          this decedent&apos;s individual assets. Taxable estate clamps to $0.
        </div>
      )}

      <div className="divide-y divide-gray-800/70">
        {/* Gross Estate */}
        <Section
          title="Gross Estate"
          subtotal={tax.grossEstate}
          subtotalLabel="Gross Estate"
          delta={diff?.totals.grossEstate}
          deltaTestId="estate-delta-gross-estate"
        >
          {tax.grossEstateLines.map((line, idx) => (
            <LineRow
              key={lineKeys[idx]}
              label={line.label}
              hint={line.percentage !== 1 ? pct.format(line.percentage) : undefined}
              badge={line.revocableTrustName ?? (line.isProbate ? "Probate" : undefined)}
              status={diff?.lines.get(lineKeys[idx])?.status}
              amount={line.amount}
            />
          ))}
          {removedLines.map(({ key, label }) => (
            <LineRow key={key} label={label} status="removed" amount={0} muted />
          ))}
          {tax.probateEstate > 0 && (
            <LineRow
              label="of which Probate Estate"
              amount={tax.probateEstate}
              muted
            />
          )}
        </Section>

        {/* Taxable Estate */}
        <Section
          title="Taxable Estate"
          subtotal={tax.taxableEstate}
          subtotalLabel="Taxable Estate"
          delta={diff?.totals.taxableEstate}
        >
          <LineRow label="Gross Estate" amount={tax.grossEstate} />
          <LineRow
            label="LESS: Probate Costs"
            amount={tax.probateCost}
            showAsDeduction
            hideIfZero
          />
          <LineRow
            label="LESS: Administrative / Final Expenses"
            amount={tax.estateAdminExpenses}
            showAsDeduction
            hideIfZero
          />
          <LineRow
            label="LESS: Marital Deduction"
            amount={tax.maritalDeduction}
            showAsDeduction
            hideIfZero
          />
          <LineRow
            label="LESS: Charitable Deduction"
            amount={tax.charitableDeduction}
            showAsDeduction
            hideIfZero
          />
        </Section>

        {/* Tentative Tax Base — only when there are lifetime gifts */}
        {showTentativeBase && (
          <Section
            title="Tentative Tax Base"
            subtotal={tax.tentativeTaxBase}
            subtotalLabel="Tentative Tax Base"
            delta={diff?.totals.tentativeTaxBase}
          >
            <LineRow label="Taxable Estate" amount={tax.taxableEstate} />
            <LineRow
              label="Adjusted Taxable Gifts During Lifetime"
              amount={tax.adjustedTaxableGifts}
            />
          </Section>
        )}

        {/* Estate Tax */}
        <Section
          title="Estate Tax"
          subtotal={tax.federalEstateTax}
          subtotalLabel="Estate Tax"
          subtotalAccent="tax"
          delta={diff?.totals.federalEstateTax}
        >
          <LineRow label="Tentative Tax" amount={tax.tentativeTax} />
          <LineRow
            label="LESS: Gift Tax Payable on Prior Gifts"
            amount={tax.giftTaxPayable}
            showAsDeduction
            hideIfZero
          />
          <LineRow
            label="LESS: Unified Credit"
            hint={unifiedCreditHint}
            amount={tax.unifiedCredit}
            showAsDeduction
          />
        </Section>

        {/* Total Taxes & Expenses */}
        <Section
          title="Total Taxes & Expenses"
          subtotal={totalTaxesAndExpenses}
          subtotalLabel="Total Taxes & Expenses"
          subtotalAccent="tax"
          delta={totalDelta}
        >
          <LineRow label="Federal Estate Tax" amount={tax.federalEstateTax} />
          <LineRow
            label="State Estate Tax"
            amount={tax.stateEstateTax}
            hideIfZero
          />
          <LineRow
            label="State Inheritance Tax"
            amount={stateInheritanceTax}
            hideIfZero
          />
          <LineRow label="Probate Costs" amount={tax.probateCost} hideIfZero />
          <LineRow
            label="Administrative / Final Expenses"
            amount={tax.estateAdminExpenses}
            hideIfZero
          />
          {irdTotal > 0 && (
            <LineRow
              label="Tax on Income with Respect to Decedent"
              amount={irdTotal}
            />
          )}
        </Section>
      </div>

      {showDsueGenerated && tax.dsueGenerated > 0 && (
        <div className="border-t border-indigo-900/40 bg-indigo-950/20 px-5 py-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs uppercase tracking-wider text-indigo-300">
              DSUE generated · ported to survivor
            </span>
            <span className="text-sm font-semibold tabular-nums text-indigo-200">
              {fmt.format(tax.dsueGenerated)}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function TotalsCard({
  heading,
  federal,
  stateEstate,
  stateInheritance,
  probate,
  admin,
  ird,
  total,
}: {
  heading: string;
  federal: number;
  stateEstate: number;
  stateInheritance: number;
  probate: number;
  admin: number;
  ird: number;
  total: number;
}) {
  const accent = total > 0 ? "text-rose-200" : "text-emerald-200";
  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Combined household
          </span>
          <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
        </div>
      </header>
      <div className="px-5 py-3">
        <LineRow label="Total federal estate tax" amount={federal} />
        <LineRow label="Total state estate tax" amount={stateEstate} hideIfZero />
        <LineRow
          label="Total state inheritance tax"
          amount={stateInheritance}
          hideIfZero
        />
        <LineRow label="Total probate costs" amount={probate} hideIfZero />
        <LineRow label="Total admin expenses" amount={admin} hideIfZero />
        <LineRow
          label="Total tax on Income with Respect to Decedent"
          amount={ird}
          hideIfZero
        />
      </div>
      <div className="border-t border-indigo-900/40 bg-indigo-950/30 px-5 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-100">
            Grand total · taxes &amp; expenses
          </span>
          <span className={"text-xl font-semibold tabular-nums " + accent}>
            {fmt.format(total)}
          </span>
        </div>
      </div>
    </section>
  );
}

function inheritanceTaxOf(r: EstateTaxResult): number {
  return r.stateInheritanceTax && !r.stateInheritanceTax.inactive
    ? r.stateInheritanceTax.totalTax
    : 0;
}

function irdTaxOf(r: EstateTaxResult): number {
  return (r.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
}

/**
 * What this tab SHOWS as one decedent's total. The engine's
 * `totalTaxesAndExpenses` is federal + state estate + admin; this adds state
 * inheritance tax (informational on the engine, but it is a state death tax)
 * and IRD income tax (which drains heirs, not the estate).
 */
function displayedTotalTaxesAndExpenses(r: EstateTaxResult): number {
  return r.totalTaxesAndExpenses + inheritanceTaxOf(r) + irdTaxOf(r);
}

function GrandTotals({ ordering }: { ordering: HypotheticalEstateTaxOrdering }) {
  const federal = ordering.totals.federal;
  const stateEstate = ordering.totals.state;
  const stateInheritance =
    inheritanceTaxOf(ordering.firstDeath)
    + (ordering.finalDeath ? inheritanceTaxOf(ordering.finalDeath) : 0);
  const probate =
    ordering.firstDeath.probateCost
    + (ordering.finalDeath ? ordering.finalDeath.probateCost : 0);
  const admin = ordering.totals.admin;
  const ird =
    irdTaxOf(ordering.firstDeath)
    + (ordering.finalDeath ? irdTaxOf(ordering.finalDeath) : 0);
  return (
    <TotalsCard
      heading="Grand totals"
      federal={federal}
      stateEstate={stateEstate}
      stateInheritance={stateInheritance}
      probate={probate}
      admin={admin}
      ird={ird}
      total={federal + stateEstate + stateInheritance + probate + admin + ird}
    />
  );
}

function SplitTotals({ first, second }: { first: EstateTaxResult; second: EstateTaxResult }) {
  const federal = first.federalEstateTax + second.federalEstateTax;
  const stateEstate = first.stateEstateTax + second.stateEstateTax;
  const stateInheritance = inheritanceTaxOf(first) + inheritanceTaxOf(second);
  const probate = first.probateCost + second.probateCost;
  const admin = first.estateAdminExpenses + second.estateAdminExpenses;
  const ird = irdTaxOf(first) + irdTaxOf(second);
  return (
    <TotalsCard
      heading="Grand totals — Split death"
      federal={federal}
      stateEstate={stateEstate}
      stateInheritance={stateInheritance}
      probate={probate}
      admin={admin}
      ird={ird}
      total={federal + stateEstate + stateInheritance + probate + admin + ird}
    />
  );
}

