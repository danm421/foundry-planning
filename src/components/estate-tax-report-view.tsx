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
    <div className="space-y-6">
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

function Row({
  label,
  amount,
  muted = false,
  bold = false,
}: {
  label: string;
  amount: number;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between border-b border-gray-800 py-1.5 text-sm " +
        (bold ? "font-semibold text-gray-100" : muted ? "text-gray-400" : "text-gray-200")
      }
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">
        {amount < 0 ? `(${fmt.format(-amount)})` : fmt.format(amount)}
      </span>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-300">
      {children}
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
  return (
    <section className="rounded border border-gray-700 bg-gray-900 p-5">
      <h2 className="text-sm font-semibold text-gray-100">{heading}</h2>

      {tax.grossEstate < 0 && (
        <p className="mt-1 text-xs text-amber-400/80">
          Gross estate is negative because attributed household debt exceeds this decedent&apos;s individual assets. Taxable estate clamps to $0.
        </p>
      )}

      <GroupHeading>Gross estate</GroupHeading>
      {tax.grossEstateLines.map((line, idx) => (
        <div
          key={`${line.accountId ?? line.liabilityId ?? "line"}-${idx}`}
          className="flex items-center justify-between border-b border-gray-800 py-1.5 text-sm text-gray-200"
        >
          <span>
            {line.label}
            {line.percentage !== 1 && (
              <span className="ml-2 text-xs text-gray-400">
                {pct.format(line.percentage)}
              </span>
            )}
          </span>
          <span className="font-mono tabular-nums">
            {line.amount < 0
              ? `(${fmt.format(-line.amount)})`
              : fmt.format(line.amount)}
          </span>
        </div>
      ))}
      <Row label="Gross estate" amount={tax.grossEstate} bold />

      <GroupHeading>Deductions</GroupHeading>
      <Row label="Estate admin expenses" amount={tax.estateAdminExpenses} />
      <Row label="Marital deduction" amount={tax.maritalDeduction} />
      <Row label="Charitable deduction" amount={tax.charitableDeduction} />
      <Row label="Taxable estate" amount={tax.taxableEstate} bold />

      <GroupHeading>Tentative tax base</GroupHeading>
      <Row label="Adjusted taxable gifts" amount={tax.adjustedTaxableGifts} />
      <Row label="Tentative tax base" amount={tax.tentativeTaxBase} bold />

      <GroupHeading>Federal estate tax</GroupHeading>
      <Row label="Tentative tax" amount={tax.tentativeTax} />
      <Row label="BEA at death year" amount={tax.beaAtDeathYear} muted />
      <Row label="DSUE received" amount={tax.dsueReceived} muted />
      <Row label="Applicable exclusion" amount={tax.applicableExclusion} muted />
      <Row label="Unified credit" amount={tax.unifiedCredit} muted />
      <Row label="Federal estate tax" amount={tax.federalEstateTax} bold />

      <GroupHeading>State estate tax</GroupHeading>
      <div className="flex items-center justify-between border-b border-gray-800 py-1.5 text-sm text-gray-400">
        <span>State rate</span>
        <span className="font-mono tabular-nums">{pct.format(tax.stateEstateTaxRate)}</span>
      </div>
      <Row label="State estate tax" amount={tax.stateEstateTax} bold />

      <GroupHeading>Totals</GroupHeading>
      <Row label="Total estate tax" amount={tax.totalEstateTax} />
      <Row label="Admin expenses" amount={tax.estateAdminExpenses} />
      <Row
        label="Total taxes & expenses"
        amount={tax.totalTaxesAndExpenses}
        bold
      />
      {showDsueGenerated && (
        <Row
          label="DSUE generated (ported to survivor)"
          amount={tax.dsueGenerated}
          muted
        />
      )}
    </section>
  );
}

function GrandTotals({ ordering }: { ordering: HypotheticalEstateTaxOrdering }) {
  return (
    <section className="rounded border border-gray-600 bg-gray-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
        Grand totals
      </h2>
      <div className="mt-3 space-y-1">
        <Row label="Total federal estate tax" amount={ordering.totals.federal} />
        <Row label="Total state estate tax" amount={ordering.totals.state} />
        <Row label="Total admin expenses" amount={ordering.totals.admin} />
        <div className="mt-2 flex items-center justify-between border-t border-gray-600 pt-2 text-base font-semibold text-gray-100">
          <span>Grand total taxes & expenses</span>
          <span className="font-mono tabular-nums">{fmt.format(ordering.totals.total)}</span>
        </div>
      </div>
    </section>
  );
}

function SplitTotals({ first, second }: { first: EstateTaxResult; second: EstateTaxResult }) {
  const federal = first.federalEstateTax + second.federalEstateTax;
  const state = first.stateEstateTax + second.stateEstateTax;
  const admin = first.estateAdminExpenses + second.estateAdminExpenses;
  const total = first.totalTaxesAndExpenses + second.totalTaxesAndExpenses;
  return (
    <section className="rounded border border-gray-600 bg-gray-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
        Grand totals — Split death
      </h2>
      <div className="mt-3 space-y-1">
        <Row label="Total federal estate tax" amount={federal} />
        <Row label="Total state estate tax" amount={state} />
        <Row label="Total admin expenses" amount={admin} />
        <div className="mt-2 flex items-center justify-between border-t border-gray-600 pt-2 text-base font-semibold text-gray-100">
          <span>Grand total taxes &amp; expenses</span>
          <span className="font-mono tabular-nums">{fmt.format(total)}</span>
        </div>
      </div>
    </section>
  );
}
