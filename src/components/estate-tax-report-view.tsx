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

interface EstateTaxReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;
}

type Ordering = "primaryFirst" | "spouseFirst";

export default function EstateTaxReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
}: EstateTaxReportViewProps) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [selectedAsOf, setSelectedAsOf] = useState<AsOfValue>("today");
  const [ordering, setOrdering] = useState<Ordering>("primaryFirst");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const url = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
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
  }, [clientId, searchParams]);

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

  if (loadError) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-4 text-red-200">
        Failed to load projection: {loadError}
      </div>
    );
  }

  if (loading) {
    return <div className="text-gray-300">Loading projection…</div>;
  }

  if (projectionYears.length === 0 || todayYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  // Split death: render decedents at their actual projected death years.
  const isSplit = selectedAsOf === "split";
  const splitFirst = isSplit ? projection?.firstDeathEvent ?? null : null;
  const splitSecond = isSplit ? projection?.secondDeathEvent ?? null : null;

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

  // ── Active orderings ──
  const activeOrdering =
    !isSplit && hypothetical
      ? ordering === "spouseFirst" && hypothetical.spouseFirst
        ? hypothetical.spouseFirst
        : hypothetical.primaryFirst
      : null;

  const firstDecedent = isSplit
    ? splitFirst?.deceased ?? null
    : activeOrdering?.firstDecedent ?? null;
  const firstDecedentName =
    firstDecedent === "client"
      ? ownerNames.clientName
      : firstDecedent === "spouse"
        ? ownerNames.spouseName ?? "Spouse"
        : null;
  const survivorName =
    firstDecedent === "client"
      ? ownerNames.spouseName ?? "Spouse"
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimePeriodButtons
          selected={selectedAsOf}
          onChange={setSelectedAsOf}
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
              onChange={setSelectedAsOf}
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
                onClick={() => setOrdering("primaryFirst")}
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
                onClick={() => setOrdering("spouseFirst")}
              >
                {ownerNames.spouseName ?? "Spouse"} dies first
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">{headerNote}</p>

      {isSplit ? (
        <>
          {splitFirst && (
            <DecedentBreakdown
              heading={`${ownerForName(splitFirst, ownerNames)} — First to die · ${splitFirst.year}`}
              tax={splitFirst}
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
  return result.deceased === "client" ? names.clientName : names.spouseName ?? "Spouse";
}

function formatAmount(amount: number, opts: { negate?: boolean } = {}): string {
  const n = opts.negate ? -amount : amount;
  return n < 0 ? `(${fmt.format(-n)})` : fmt.format(n);
}

function LineRow({
  label,
  amount,
  hint,
  muted = false,
  showAsDeduction = false,
  hideIfZero = false,
}: {
  label: string;
  amount: number;
  hint?: string;
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
      <span className="truncate">
        {label}
        {hint && <span className="ml-2 text-xs text-gray-500">{hint}</span>}
      </span>
      <span
        className={
          "shrink-0 font-mono tabular-nums " +
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
  children,
}: {
  title: string;
  subtotal: number;
  subtotalLabel: string;
  subtotalAccent?: SubtotalAccent;
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
        <span
          className={
            "font-mono text-base font-semibold tabular-nums " + accentClass
          }
        >
          {formatAmount(subtotal)}
        </span>
      </div>
    </div>
  );
}

function DecedentBreakdown({
  heading,
  tax,
  showDsueGenerated,
}: {
  heading: string;
  tax: EstateTaxResult;
  showDsueGenerated: boolean;
}) {
  const irdTotal = (tax.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);

  // Headline matches eMoney's "Total Taxes & Expenses": engine's
  // totalTaxesAndExpenses (estate tax + admin) plus IRD income tax. IRD is
  // separate in the engine because it's income tax on heirs, not an
  // estate-administered drain.
  const totalTaxesAndExpenses = tax.totalTaxesAndExpenses + irdTotal;
  const headlineColor =
    totalTaxesAndExpenses > 0 ? "text-rose-200" : "text-emerald-200";

  const showState = tax.stateEstateTaxRate > 0 || tax.stateEstateTax > 0;
  const showTentativeBase =
    tax.adjustedTaxableGifts > 0 || tax.lifetimeGiftTaxAdjustment > 0;
  const unifiedCreditHint = `(${fmt.format(tax.beaAtDeathYear)} Basic Exclusion + ${fmt.format(tax.dsueReceived)} DSUE)`;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 px-5 py-3">
        <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
            Total Taxes &amp; Expenses
          </span>
          <span
            className={
              "font-mono text-xl font-semibold tabular-nums " + headlineColor
            }
          >
            {fmt.format(totalTaxesAndExpenses)}
          </span>
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
        >
          {tax.grossEstateLines.map((line, idx) => (
            <LineRow
              key={`${line.accountId ?? line.liabilityId ?? "line"}-${idx}`}
              label={line.label}
              hint={line.percentage !== 1 ? pct.format(line.percentage) : undefined}
              amount={line.amount}
            />
          ))}
        </Section>

        {/* Taxable Estate */}
        <Section
          title="Taxable Estate"
          subtotal={tax.taxableEstate}
          subtotalLabel="Taxable Estate"
        >
          <LineRow label="Gross Estate" amount={tax.grossEstate} />
          <LineRow
            label="LESS: Probate and Final Expenses"
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
          >
            <LineRow label="Taxable Estate" amount={tax.taxableEstate} />
            <LineRow
              label="Adjusted Taxable Gifts During Lifetime"
              amount={tax.adjustedTaxableGifts}
            />
            <LineRow
              label="Gift Tax Rolled Back"
              amount={tax.lifetimeGiftTaxAdjustment}
            />
          </Section>
        )}

        {/* Estate Tax */}
        <Section
          title="Estate Tax"
          subtotal={tax.federalEstateTax}
          subtotalLabel="Estate Tax"
          subtotalAccent="tax"
        >
          <LineRow label="Tentative Tax" amount={tax.tentativeTax} />
          <LineRow
            label="LESS: Unified Credit"
            hint={unifiedCreditHint}
            amount={tax.unifiedCredit}
            showAsDeduction
          />
        </Section>

        {/* State Estate Tax — only when applicable */}
        {showState && (
          <Section
            title="State Estate Tax"
            subtotal={tax.stateEstateTax}
            subtotalLabel="State Estate Tax"
            subtotalAccent="tax"
          >
            <LineRow
              label={`Taxable Estate × ${pct.format(tax.stateEstateTaxRate)}`}
              amount={tax.stateEstateTax}
            />
          </Section>
        )}

        {/* Total Taxes & Expenses */}
        <Section
          title="Total Taxes & Expenses"
          subtotal={totalTaxesAndExpenses}
          subtotalLabel="Total Taxes & Expenses"
          subtotalAccent="tax"
        >
          <LineRow label="Estate Tax" amount={tax.federalEstateTax} />
          <LineRow
            label="State Estate Tax"
            amount={tax.stateEstateTax}
            hideIfZero
          />
          <LineRow
            label="Probate and Final Expenses"
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
        <div className="flex items-baseline justify-between gap-4 border-t border-indigo-900/40 bg-indigo-950/20 px-5 py-2">
          <span className="text-xs uppercase tracking-wider text-indigo-300">
            DSUE generated · ported to survivor
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums text-indigo-200">
            {fmt.format(tax.dsueGenerated)}
          </span>
        </div>
      )}
    </section>
  );
}

function TotalsCard({
  heading,
  federal,
  state,
  admin,
  total,
}: {
  heading: string;
  federal: number;
  state: number;
  admin: number;
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
        <LineRow label="Total state estate tax" amount={state} hideIfZero />
        <LineRow label="Total admin expenses" amount={admin} hideIfZero />
      </div>
      <div className="flex items-baseline justify-between gap-4 border-t border-indigo-900/40 bg-indigo-950/30 px-5 py-3">
        <span className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-100">
          Grand total · taxes &amp; expenses
        </span>
        <span className={"font-mono text-xl font-semibold tabular-nums " + accent}>
          {fmt.format(total)}
        </span>
      </div>
    </section>
  );
}

function GrandTotals({ ordering }: { ordering: HypotheticalEstateTaxOrdering }) {
  return (
    <TotalsCard
      heading="Grand totals"
      federal={ordering.totals.federal}
      state={ordering.totals.state}
      admin={ordering.totals.admin}
      total={ordering.totals.total}
    />
  );
}

function SplitTotals({ first, second }: { first: EstateTaxResult; second: EstateTaxResult }) {
  return (
    <TotalsCard
      heading="Grand totals — Split death"
      federal={first.federalEstateTax + second.federalEstateTax}
      state={first.stateEstateTax + second.stateEstateTax}
      admin={first.estateAdminExpenses + second.estateAdminExpenses}
      total={first.totalTaxesAndExpenses + second.totalTaxesAndExpenses}
    />
  );
}
