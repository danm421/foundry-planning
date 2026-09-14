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
import { USPS_STATE_NAMES, type USPSStateCode } from "@/lib/usps-states";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { TimePeriodButtons } from "./report-controls/time-period-buttons";
import type { OwnerDobs } from "./report-controls/age-helpers";
import type { EstateColumnReady } from "./estate-compare-shell";
import { useEstateColumnReady } from "@/hooks/use-estate-column-ready";
import { useEstateTaxColumnData } from "@/hooks/use-estate-tax-column-data";
import { EstateDeltaChip } from "./estate-delta-chip";
import {
  diffStateEstateTax,
  type EstateTaxColumnData,
} from "@/lib/estate/diff-estate-tax";
import { BASE_REF, readCompareSelection } from "@/lib/estate/compare-ref";
import { personLabel } from "@/lib/owner-labels";
import EstateTaxSkeleton from "@/app/(app)/clients/[id]/estate-planning/estate-tax/loading-skeleton";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

type Ordering = "primaryFirst" | "spouseFirst";

interface Props {
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
  /** Reports this column's projection metadata and report data upward. */
  onReady?: (ready: EstateColumnReady<EstateTaxColumnData>) => void;
  /** The other column's report data; its presence switches on deltas. */
  baseline?: EstateTaxColumnData | null;
}

export default function StateDeathTaxReportView({
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
}: Props) {
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
    // Keyed on the resolved ref, never on `searchParams`: that object is fresh
    // whenever ANY param changes, so toggling `?compare=` would refetch both
    // columns against a 30/min/firm rate limit.
  }, [clientId, resolvedScenarioRef]);

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

  // Split death: render decedents at their actual projected death years.
  const isSplit = selectedAsOf === "split";
  const splitFirst = isSplit ? projection?.firstDeathEvent ?? null : null;
  const splitSecond = isSplit ? projection?.secondDeathEvent ?? null : null;

  const activeOrdering: HypotheticalEstateTaxOrdering | null =
    !isSplit && hypothetical
      ? ordering === "spouseFirst" && hypothetical.spouseFirst
        ? hypothetical.spouseFirst
        : hypothetical.primaryFirst
      : null;

  const columnData = useEstateTaxColumnData(
    isSplit,
    splitFirst,
    splitSecond,
    activeOrdering,
  );

  useEstateColumnReady(projection, columnData, onReady);

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
        No projection data available.
      </div>
    );
  }

  if (!isSplit && !hypothetical) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No state death tax snapshot available for {resolvedYear}.
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
        ? personLabel("spouse", ownerNames)
        : null;
  const survivorName =
    firstDecedent === "client"
      ? personLabel("spouse", ownerNames)
      : firstDecedent === "spouse"
        ? ownerNames.clientName
        : null;

  const visibleDeaths: EstateTaxResult[] = isSplit
    ? [splitFirst, splitSecond].filter((x): x is EstateTaxResult => x != null)
    : activeOrdering
      ? [activeOrdering.firstDeath, ...(activeOrdering.finalDeath ? [activeOrdering.finalDeath] : [])]
      : [];

  const anyStateDeathTax = visibleDeaths.some(hasAnyStateDeathTax);
  const residenceState = visibleDeaths[0]?.residenceState ?? null;

  return (
    <div className="space-y-4 pt-4 text-gray-100">
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
                  className={ordering === "primaryFirst"
                    ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                    : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"}
                  onClick={() => setOwnOrdering("primaryFirst")}
                >
                  {ownerNames.clientName} dies first
                </button>
                <button
                  type="button"
                  className={ordering === "spouseFirst"
                    ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                    : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"}
                  onClick={() => setOwnOrdering("spouseFirst")}
                >
                  {personLabel("spouse", ownerNames)} dies first
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!anyStateDeathTax ? (
        <NoStateDeathTaxLegend residenceState={residenceState} />
      ) : isSplit ? (
        <>
          {splitFirst && (
            <DecedentSection
              heading={`${ownerForName(splitFirst, ownerNames)} — First to die · ${splitFirst.year}`}
              tax={splitFirst}
              baseline={baseline?.firstDeath ?? null}
            />
          )}
          {splitSecond && (
            <DecedentSection
              heading={`${ownerForName(splitSecond, ownerNames)} — Second to die · ${splitSecond.year}`}
              tax={splitSecond}
              baseline={baseline?.finalDeath ?? null}
            />
          )}
          {splitFirst && splitSecond && (
            <GrandTotalsCard
              first={splitFirst}
              second={splitSecond}
              baseline={baseline}
            />
          )}
        </>
      ) : (
        activeOrdering && (
          <>
            <DecedentSection
              heading={`${firstDecedentName} — ${isMarried ? "First to die" : `Hypothetical death in ${resolvedYear}`}`}
              tax={activeOrdering.firstDeath}
              baseline={baseline?.firstDeath ?? null}
            />
            {isMarried && activeOrdering.finalDeath && survivorName && (
              <DecedentSection
                heading={`${survivorName} — Second to die`}
                tax={activeOrdering.finalDeath}
                baseline={baseline?.finalDeath ?? null}
              />
            )}
            {isMarried && activeOrdering.firstDeath && activeOrdering.finalDeath && (
              <GrandTotalsCard
                first={activeOrdering.firstDeath}
                second={activeOrdering.finalDeath}
                baseline={baseline}
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
  return r.deceased === "client" ? names.clientName : personLabel("spouse", names);
}

function formatAmount(amount: number, opts: { negate?: boolean } = {}): string {
  const n = opts.negate ? -amount : amount;
  return n < 0 ? `(${fmt.format(-n)})` : fmt.format(n);
}

function LineRow({
  label,
  amount,
  hint,
  delta,
  // Every figure on this report is a tax base or a tax, where a fall is the
  // good news — except the exemption, which says so at its call site.
  deltaGoodDirection = "down",
  muted = false,
  showAsDeduction = false,
  hideIfZero = false,
}: {
  label: string;
  amount: number;
  hint?: string;
  /** Compare mode: this row's change against the other column. */
  delta?: number | null;
  deltaGoodDirection?: "up" | "down";
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
      <span className="flex shrink-0 items-baseline gap-2">
        {delta != null && (
          <EstateDeltaChip delta={delta} goodDirection={deltaGoodDirection} />
        )}
        <span className={"tabular-nums " + (negative ? "text-rose-300/90" : muted ? "text-gray-500" : "text-gray-200")}>
          {value}
        </span>
      </span>
    </div>
  );
}

function Section({
  title, subtotal, subtotalLabel, delta, deltaTestId, children,
}: {
  title: string;
  subtotal: number;
  subtotalLabel: string;
  /** Compare mode: this subtotal's change against the other column. */
  delta?: number | null;
  deltaTestId?: string;
  children: React.ReactNode;
}) {
  const accent = subtotal > 0 ? "text-rose-200" : "text-emerald-200";
  return (
    <div className="px-5 py-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-200">{title}</h3>
      <div>{children}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-gray-800/80 pt-1.5">
        <span className={"text-sm font-medium " + accent}>{subtotalLabel}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          {delta != null && (
            // Every subtotal here is a death tax, so a fall is the good news.
            <EstateDeltaChip delta={delta} goodDirection="down" testId={deltaTestId} />
          )}
          <span className={"text-base font-semibold tabular-nums " + accent}>{formatAmount(subtotal)}</span>
        </span>
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

/** Compare mode: this decedent's state figures against the other column's. */
type StateDiff = ReturnType<typeof diffStateEstateTax>;

function StateEstateTaxSection({
  detail,
  diff = null,
}: {
  detail: StateEstateTaxResult;
  diff?: StateDiff | null;
}) {
  const subtotalDelta = diff?.stateEstateTax;
  const subtotalTestId = "estate-delta-state-estate-tax";
  if (detail.fallbackUsed) {
    return (
      <Section
        title="State Estate Tax (Custom Override)"
        subtotal={detail.stateEstateTax}
        subtotalLabel="State Estate Tax"
        delta={subtotalDelta}
        deltaTestId={subtotalTestId}
      >
        <LineRow label={`Taxable Estate × ${(detail.fallbackRate * 100).toFixed(2)}%`} amount={detail.stateEstateTax} />
      </Section>
    );
  }
  return (
    <Section
      title={`State Estate Tax (${stateFullName(detail.state)})`}
      subtotal={detail.stateEstateTax}
      subtotalLabel="State Estate Tax"
      delta={subtotalDelta}
      deltaTestId={subtotalTestId}
    >
      <LineRow label="Taxable Estate" amount={detail.baseForTax - detail.giftAddback} />
      {detail.giftAddback > 0 && <LineRow label="State gift addback" amount={detail.giftAddback} />}
      <LineRow label="Base for State Tax" amount={detail.baseForTax} delta={diff?.baseForTax} />
      <LineRow
        label={`Exemption (${detail.exemptionYear})`}
        amount={detail.exemption}
        delta={diff?.exemption}
        // A bigger exemption shelters more of the estate — the one figure on
        // this report where a RISE is the good news.
        deltaGoodDirection="up"
        showAsDeduction
      />
      <LineRow label="Amount Over Exemption" amount={detail.amountOverExemption} delta={diff?.amountOverExemption} />
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

function deathTotal(r: EstateTaxResult): number {
  return r.stateEstateTax + (r.stateInheritanceTax && !r.stateInheritanceTax.inactive
    ? r.stateInheritanceTax.totalTax
    : 0);
}

/** One column's household state death tax: both deaths, or the one there is. */
function householdStateTotal(d: EstateTaxColumnData): number {
  return deathTotal(d.firstDeath) + (d.finalDeath ? deathTotal(d.finalDeath) : 0);
}

function hasAnyStateDeathTax(r: EstateTaxResult): boolean {
  const d = r.stateEstateTaxDetail;
  if (d.fallbackUsed || d.state != null || d.stateEstateTax > 0) return true;
  if (r.stateInheritanceTax && !r.stateInheritanceTax.inactive) return true;
  return false;
}

function NoStateDeathTaxLegend({ residenceState }: { residenceState: USPSStateCode | null }) {
  const label = residenceState != null ? USPS_STATE_NAMES[residenceState] : "This state";
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-200">
      <p>{label} does not levy a state estate tax or inheritance tax.</p>
      <p className="mt-2 text-xs text-gray-400">
        State estate tax states: CT, DC, HI, IL, ME, MD, MA, MN, NY, OR, RI, VT, WA.
      </p>
      <p className="mt-1 text-xs text-gray-400">
        State inheritance tax states: PA, NJ, KY, NE, MD.
      </p>
    </div>
  );
}

function GrandTotalsCard({
  first,
  second,
  baseline = null,
}: {
  first: EstateTaxResult;
  second: EstateTaxResult;
  /** The other column's report data; null outside compare mode. */
  baseline?: EstateTaxColumnData | null;
}) {
  const total = deathTotal(first) + deathTotal(second);
  const accent = total > 0 ? "text-rose-200" : "text-emerald-200";
  // Computed on both sides the same way the figure beside it is — never by
  // summing the two per-death deltas, which measure a different quantity.
  const delta = baseline ? total - householdStateTotal(baseline) : null;
  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="border-b border-indigo-900/40 px-5 py-3">
        <h2 className="text-base font-semibold text-gray-50">Grand totals — state death taxes</h2>
      </header>
      <div className="px-5 py-3">
        <LineRow label="First decedent state death tax" amount={deathTotal(first)} />
        <LineRow label="Second decedent state death tax" amount={deathTotal(second)} />
      </div>
      <div className="border-t border-indigo-900/40 bg-indigo-950/30 px-5 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-100">
            Total state death taxes
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            {delta != null && (
              <EstateDeltaChip
                delta={delta}
                goodDirection="down"
                testId="estate-delta-grand-total"
              />
            )}
            <span className={"text-xl font-semibold tabular-nums " + accent}>
              {fmt.format(total)}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function DecedentSection({
  heading,
  tax,
  baseline = null,
}: {
  heading: string;
  tax: EstateTaxResult;
  /** The other column's result for this same death; null outside compare mode. */
  baseline?: EstateTaxResult | null;
}) {
  const stateDetail = tax.stateEstateTaxDetail;
  const sti = tax.stateInheritanceTax && !tax.stateInheritanceTax.inactive
    ? tax.stateInheritanceTax
    : null;
  const showEstate = stateDetail.stateEstateTax > 0 || stateDetail.fallbackUsed || stateDetail.state != null;
  // In SPLIT death each column emits whoever dies first in ITS OWN projection,
  // so a scenario that moves a death year can pair this section's decedent
  // against the other column's OTHER spouse — a $-figure that is not a change
  // in anything. Outside split both columns are pinned to the same decedent by
  // the shell's shared ordering, so this can never suppress a legitimate chip.
  const diff =
    baseline && baseline.deceased === tax.deceased
      ? diffStateEstateTax(baseline.stateEstateTaxDetail, stateDetail)
      : null;

  if (!showEstate && !sti) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="border-b border-gray-800 px-5 py-3">
        <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
      </header>
      <div className="divide-y divide-gray-800/70">
        {showEstate && <StateEstateTaxSection detail={stateDetail} diff={diff} />}
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
        {sti && stateDetail.inheritanceCredit != null && (
          <div className="border-t border-amber-900/40 bg-amber-950/20 px-5 py-2 text-sm text-amber-200">
            MD inheritance tax of {fmt.format(sti.totalTax)} reduces MD state estate tax
            via the inheritance-tax credit (credit applied: {fmt.format(stateDetail.inheritanceCredit.reduction)}).
          </div>
        )}
        {showEstate && sti && (
          <div className="border-t border-gray-800 bg-gray-900/40 px-5 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-100">
                Total state death tax
              </span>
              <span className="text-base font-semibold tabular-nums text-rose-200">
                {fmt.format(stateDetail.stateEstateTax + sti.totalTax)}
              </span>
            </div>
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
