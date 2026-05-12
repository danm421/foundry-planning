"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import type {
  EstateTaxResult,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import type { InheritanceRecipientResult } from "@/lib/tax/state-inheritance";
import type { StateCode, StateEstateTaxResult } from "@/lib/tax/state-estate";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { TimePeriodButtons } from "./report-controls/time-period-buttons";
import type { OwnerDobs } from "./report-controls/age-helpers";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface Props {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;
}

type Ordering = "primaryFirst" | "spouseFirst";

export default function StateDeathTaxReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
}: Props) {
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
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setProjection(result);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clientId, searchParams]);

  const projectionYears = useMemo(() => projection?.years ?? [], [projection]);
  const todayYear = projectionYears[0]?.year;
  const firstDeathYear = projection?.firstDeathEvent?.year;
  const secondDeathYear = projection?.secondDeathEvent?.year;
  const lastDeathYear = secondDeathYear ?? firstDeathYear;

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
        No projection data available.
      </div>
    );
  }

  const isSplit = selectedAsOf === "split";

  if (!isSplit && !hypothetical) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No state death tax snapshot available for {resolvedYear}.
      </div>
    );
  }

  const splitFirst = isSplit ? projection?.firstDeathEvent ?? null : null;
  const splitSecond = isSplit ? projection?.secondDeathEvent ?? null : null;

  const milestones = [
    { year: retirementYear, label: "Retirement" },
    ...(firstDeathYear != null ? [{ year: firstDeathYear, label: "First Death" }] : []),
    ...(secondDeathYear != null ? [{ year: secondDeathYear, label: "Last Death" }] : []),
  ];

  const dropdownYears = projectionYears.map((y) => y.year);

  const activeOrdering: HypotheticalEstateTaxOrdering | null =
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

  return (
    <div className="space-y-4 pt-4 text-gray-100">
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
                className={ordering === "primaryFirst"
                  ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                  : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"}
                onClick={() => setOrdering("primaryFirst")}
              >
                {ownerNames.clientName} dies first
              </button>
              <button
                type="button"
                className={ordering === "spouseFirst"
                  ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                  : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"}
                onClick={() => setOrdering("spouseFirst")}
              >
                {ownerNames.spouseName ?? "Spouse"} dies first
              </button>
            </div>
          )}
        </div>
      </div>

      {isSplit ? (
        <>
          {splitFirst && (
            <DecedentSection
              heading={`${ownerForName(splitFirst, ownerNames)} — First to die · ${splitFirst.year}`}
              tax={splitFirst}
            />
          )}
          {splitSecond && (
            <DecedentSection
              heading={`${ownerForName(splitSecond, ownerNames)} — Second to die · ${splitSecond.year}`}
              tax={splitSecond}
            />
          )}
        </>
      ) : (
        activeOrdering && (
          <>
            <DecedentSection
              heading={`${firstDecedentName} — ${isMarried ? "First to die" : `Hypothetical death in ${resolvedYear}`}`}
              tax={activeOrdering.firstDeath}
            />
            {isMarried && activeOrdering.finalDeath && survivorName && (
              <DecedentSection
                heading={`${survivorName} — Second to die`}
                tax={activeOrdering.finalDeath}
              />
            )}
          </>
        )
      )}
    </div>
  );
}

function ownerForName(
  r: EstateTaxResult,
  names: { clientName: string; spouseName: string | null },
): string {
  return r.deceased === "client" ? names.clientName : names.spouseName ?? "Spouse";
}

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

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
    <div className={"flex items-baseline justify-between gap-4 py-1 text-sm " + (muted ? "text-gray-500" : "text-gray-300")}>
      <span className="min-w-0 break-words">
        {label}
        {hint && <span className="ml-2 text-xs text-gray-500">{hint}</span>}
      </span>
      <span className={"shrink-0 tabular-nums " + (negative ? "text-rose-300/90" : muted ? "text-gray-500" : "text-gray-200")}>
        {value}
      </span>
    </div>
  );
}

function Section({
  title, subtotal, subtotalLabel, children,
}: { title: string; subtotal: number; subtotalLabel: string; children: React.ReactNode }) {
  const accent = subtotal > 0 ? "text-rose-200" : "text-emerald-200";
  return (
    <div className="px-5 py-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-200">{title}</h3>
      <div>{children}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-gray-800/80 pt-1.5">
        <span className={"text-sm font-medium " + accent}>{subtotalLabel}</span>
        <span className={"text-base font-semibold tabular-nums " + accent}>{formatAmount(subtotal)}</span>
      </div>
    </div>
  );
}

const STATE_FULL_NAME: Record<StateCode, string> = {
  CT: "Connecticut", DC: "District of Columbia", HI: "Hawaii",
  IL: "Illinois", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MN: "Minnesota", NY: "New York", OR: "Oregon",
  RI: "Rhode Island", VT: "Vermont", WA: "Washington",
};
function stateFullName(code: StateCode | null): string {
  return code == null ? "—" : STATE_FULL_NAME[code];
}
function fmtBound(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

function StateEstateTaxSection({ detail }: { detail: StateEstateTaxResult }) {
  if (detail.fallbackUsed) {
    return (
      <Section title="State Estate Tax (Custom Override)" subtotal={detail.stateEstateTax} subtotalLabel="State Estate Tax">
        <LineRow label={`Taxable Estate × ${(detail.fallbackRate * 100).toFixed(2)}%`} amount={detail.stateEstateTax} />
      </Section>
    );
  }
  return (
    <Section title={`State Estate Tax (${stateFullName(detail.state)})`} subtotal={detail.stateEstateTax} subtotalLabel="State Estate Tax">
      <LineRow label="Taxable Estate" amount={detail.baseForTax - detail.giftAddback} />
      {detail.giftAddback > 0 && <LineRow label="State gift addback" amount={detail.giftAddback} />}
      <LineRow label="Base for State Tax" amount={detail.baseForTax} />
      <LineRow label={`Exemption (${detail.exemptionYear})`} amount={detail.exemption} showAsDeduction />
      <LineRow label="Amount Over Exemption" amount={detail.amountOverExemption} />
      {detail.bracketLines.map((b, i) => (
        <LineRow
          key={i}
          label={`$${fmtBound(b.from)} – ${b.to === null ? "no limit" : `$${fmtBound(b.to)}`} × ${(b.rate * 100).toFixed(2)}%`}
          amount={b.tax}
        />
      ))}
      {detail.cap?.applied && (
        <LineRow label={`Max combined cap ($${fmtBound(detail.cap.cap)})`} amount={detail.cap.reduction} showAsDeduction />
      )}
      {detail.notes.length > 0 && (
        <div className="mt-3 space-y-1 pb-1 text-xs text-gray-400">
          {detail.notes.map((n, i) => <div key={i}>• {n}</div>)}
        </div>
      )}
    </Section>
  );
}

function DecedentSection({ heading, tax }: { heading: string; tax: EstateTaxResult }) {
  const stateDetail = tax.stateEstateTaxDetail;
  const sti = tax.stateInheritanceTax && !tax.stateInheritanceTax.inactive
    ? tax.stateInheritanceTax
    : null;
  const showEstate = stateDetail.stateEstateTax > 0 || stateDetail.fallbackUsed || stateDetail.state != null;

  if (!showEstate && !sti) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="border-b border-gray-800 px-5 py-3">
        <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
      </header>
      <div className="divide-y divide-gray-800/70">
        {showEstate && <StateEstateTaxSection detail={stateDetail} />}
        {sti && (
          <div className="px-5 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-200">
              State Inheritance Tax ({sti.state})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-xs uppercase text-gray-400">
                    <th className="py-2 pr-3 text-left">Recipient</th>
                    <th className="px-3 text-left">Class</th>
                    <th className="px-3 text-right">Gross share</th>
                    <th className="px-3 text-right">Excluded</th>
                    <th className="px-3 text-right">Exemption</th>
                    <th className="px-3 text-right">Taxable</th>
                    <th className="px-3 text-right">Tax</th>
                    <th className="pl-3 text-right">Net to recipient</th>
                  </tr>
                </thead>
                <tbody>
                  {sti.perRecipient.map((r) => <RecipientRow key={r.recipientKey} r={r} />)}
                  <tr className="border-t border-gray-800 font-medium">
                    <td className="py-2 pr-3" colSpan={6}>Total inheritance tax</td>
                    <td className="px-3 text-right">{fmt.format(sti.totalTax)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {sti.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-gray-400">
                {sti.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function RecipientRow({ r }: { r: InheritanceRecipientResult }) {
  return (
    <tr className="border-b border-gray-800/60">
      <td className="py-2 pr-3">{r.label}</td>
      <td className="px-3">
        Class {r.classLabel}
        <span className="ml-1 text-xs text-gray-500">({r.classSource})</span>
        {r.excludedReasons.length > 0 && (
          <div className="mt-1 text-xs text-gray-500">
            {r.excludedReasons.map((reason, i) => <div key={i}>{reason}</div>)}
          </div>
        )}
      </td>
      <td className="px-3 text-right">{fmt.format(r.grossShare)}</td>
      <td className="px-3 text-right">{fmt.format(r.excluded)}</td>
      <td className="px-3 text-right">{fmt.format(r.exemption)}</td>
      <td className="px-3 text-right">{fmt.format(r.taxableShare)}</td>
      <td className="px-3 text-right">{fmt.format(r.tax)}</td>
      <td className="pl-3 text-right">{fmt.format(r.netToRecipient)}</td>
    </tr>
  );
}
