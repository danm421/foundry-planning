"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine/projection";
import type { EstateTaxResult, HypotheticalEstateTaxOrdering, ProjectionYear } from "@/engine/types";

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
}

type Ordering = "primaryFirst" | "spouseFirst";

export default function EstateTaxReportView({
  clientId,
  isMarried,
  ownerNames,
}: EstateTaxReportViewProps) {
  const searchParams = useSearchParams();
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
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
        const projection = runProjection(data);
        if (cancelled) return;
        setProjectionYears(projection);
        if (projection.length > 0) setSelectedYear(projection[0].year);
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

  const selectedProjectionYear = useMemo(() => {
    if (selectedYear == null) return null;
    return projectionYears.find((y) => y.year === selectedYear) ?? null;
  }, [projectionYears, selectedYear]);

  const hypothetical = selectedProjectionYear?.hypotheticalEstateTax ?? null;

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

  if (projectionYears.length === 0 || !hypothetical || selectedYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  const activeOrdering =
    ordering === "spouseFirst" && hypothetical.spouseFirst
      ? hypothetical.spouseFirst
      : hypothetical.primaryFirst;

  const firstDecedentName =
    activeOrdering.firstDecedent === "client"
      ? ownerNames.clientName
      : ownerNames.spouseName ?? "Spouse";
  const survivorName =
    activeOrdering.firstDecedent === "client"
      ? ownerNames.spouseName ?? "Spouse"
      : ownerNames.clientName;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-wide text-gray-300">
            As of
          </label>
          <select
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {projectionYears.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </select>
        </div>
        {isMarried && (
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

      <p className="text-xs text-gray-400">
        {isMarried
          ? `Assumes both clients die in ${selectedYear}. Hypothetical only.`
          : `Assumes ${firstDecedentName} dies in ${selectedYear}. Hypothetical only.`}
      </p>

      <DecedentBreakdown
        heading={`${firstDecedentName} — ${isMarried ? "First to die" : `Hypothetical death in ${selectedYear}`}`}
        tax={activeOrdering.firstDeath}
        showDsueGenerated={isMarried}
      />
      {isMarried && activeOrdering.finalDeath && (
        <DecedentBreakdown
          heading={`${survivorName} — Second to die`}
          tax={activeOrdering.finalDeath}
          showDsueGenerated={false}
        />
      )}

      {isMarried && activeOrdering.finalDeath && (
        <GrandTotals ordering={activeOrdering} />
      )}
    </div>
  );
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
