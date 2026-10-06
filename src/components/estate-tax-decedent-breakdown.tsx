"use client";

import { createContext, useContext } from "react";
import type { EstateTaxResult } from "@/engine/types";
import { EstateDeltaChip, EstateRowMarker } from "./estate-delta-chip";
import {
  diffEstateTax,
  grossEstateLineKeys,
  type LineStatus,
} from "@/lib/estate/diff-estate-tax";

// One decedent's Form 706 calculation — gross estate down to total taxes and
// expenses. Rendered full-size on the Estate Tax page and compact inside the
// Estate Flow death column's tax box.

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

/** Compact type and padding for a narrow column. */
const DenseContext = createContext(false);

function formatAmount(amount: number, opts: { negate?: boolean } = {}): string {
  const n = opts.negate ? -amount : amount;
  return n < 0 ? `(${fmt.format(-n)})` : fmt.format(n);
}

export function LineRow({
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
  const dense = useContext(DenseContext);
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
        "flex items-baseline justify-between gap-4 " +
        (dense ? "py-0.5 text-xs " : "py-1 text-sm ") +
        (muted ? "text-ink-4" : "text-ink-3")
      }
    >
      <span className="min-w-0 break-words">
        {label}
        {badge && (
          <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/90">
            {badge}
          </span>
        )}
        {hint && (
          <span className={"ml-2 text-ink-4 " + (dense ? "text-[10px]" : "text-xs")}>
            {hint}
          </span>
        )}
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
          (negative ? "text-rose-300/90" : muted ? "text-ink-4" : "text-ink-2")
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
  const dense = useContext(DenseContext);
  const accentClass =
    subtotalAccent === "tax"
      ? subtotal > 0
        ? "text-rose-200"
        : "text-emerald-200"
      : "text-ink";
  return (
    <div className={dense ? "px-3 py-2" : "px-5 py-3"}>
      <h3
        className={
          "mb-1 font-semibold uppercase tracking-[0.16em] text-ink-2 " +
          (dense ? "text-[10px]" : "text-xs")
        }
      >
        {title}
      </h3>
      <div>{children}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-hair pt-1.5">
        <span className={"font-medium " + (dense ? "text-xs " : "text-sm ") + accentClass}>
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
              "font-semibold tabular-nums " +
              (dense ? "text-xs " : "text-base ") +
              accentClass
            }
          >
            {formatAmount(subtotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * The calculation without a heading: gross estate → taxable estate →
 * (tentative tax base) → estate tax → total taxes & expenses, then the DSUE
 * the first death ports to the survivor. `dense` sizes it for a narrow column.
 */
export function DecedentTaxCalculation({
  tax,
  baseline = null,
  showDsueGenerated,
  dense = false,
}: {
  tax: EstateTaxResult;
  /** The other column's result for this same death; null outside compare mode. */
  baseline?: EstateTaxResult | null;
  showDsueGenerated: boolean;
  dense?: boolean;
}) {
  const irdTotal = irdTaxOf(tax);
  const stateInheritanceTax = inheritanceTaxOf(tax);
  const totalTaxesAndExpenses = displayedTotalTaxesAndExpenses(tax);

  // In SPLIT death each column emits whoever dies first in ITS OWN projection,
  // so a scenario that moves a death year can pair this card's decedent against
  // the other column's OTHER spouse. Differencing two different people prints a
  // $-figure that is not a change in anything, and keys every account in one
  // estate `removed` and every account in the other `added`. Outside split both
  // columns are pinned to the same decedent by the shell's shared ordering, so
  // this can never suppress a chip that is legitimately shown today.
  const comparable =
    baseline && baseline.deceased === tax.deceased ? baseline : null;

  const diff = comparable ? diffEstateTax(comparable, tax) : null;
  const lineKeys = grossEstateLineKeys(tax.grossEstateLines);
  // An asset the other scenario holds and this one does not still gets a row,
  // at $0 — otherwise "gifted the business out of the estate" reads as a line
  // that was never there, and `removed` is unreachable in this view.
  const removedLines = comparable
    ? grossEstateLineKeys(comparable.grossEstateLines)
        .map((key, i) => ({ key, label: comparable.grossEstateLines[i].label }))
        .filter(({ key }) => diff?.lines.get(key)?.status === "removed")
    : [];
  // The engine's `totalTaxesAndExpenses` omits state inheritance and IRD tax,
  // which this card adds in — so this delta is computed the same way the
  // figure beside it is, never read off `diff.totals`.
  const totalDelta = comparable
    ? totalTaxesAndExpenses - displayedTotalTaxesAndExpenses(comparable)
    : null;

  const showTentativeBase = tax.adjustedTaxableGifts > 0;
  const unifiedCreditHint = `(${fmt.format(tax.beaAtDeathYear)} Basic Exclusion + ${fmt.format(tax.dsueReceived)} DSUE)`;
  const padX = dense ? "px-3" : "px-5";

  return (
    <DenseContext.Provider value={dense}>
      {tax.grossEstate < 0 && (
        <div
          className={`border-b border-amber-900/40 bg-amber-950/30 ${padX} py-2 text-xs text-amber-200/90`}
        >
          Gross estate is negative because attributed household debt exceeds
          this decedent&apos;s individual assets. Taxable estate clamps to $0.
        </div>
      )}

      <div className="divide-y divide-hair">
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
        <div className={`border-t border-indigo-900/40 bg-indigo-950/20 ${padX} py-2`}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs uppercase tracking-wider text-indigo-300">
              DSUE generated · ported to survivor
            </span>
            <span
              className={
                "font-semibold tabular-nums text-indigo-200 " +
                (dense ? "text-xs" : "text-sm")
              }
            >
              {fmt.format(tax.dsueGenerated)}
            </span>
          </div>
        </div>
      )}
    </DenseContext.Provider>
  );
}

export function DecedentBreakdown({
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
  const totalTaxesAndExpenses = displayedTotalTaxesAndExpenses(tax);
  const headlineColor =
    totalTaxesAndExpenses > 0 ? "text-rose-200" : "text-emerald-200";

  return (
    <section className="overflow-hidden rounded-xl border border-hair bg-card-2">
      <header className="border-b border-hair px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">{heading}</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-4">
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

      <DecedentTaxCalculation
        tax={tax}
        baseline={baseline}
        showDsueGenerated={showDsueGenerated}
      />
    </section>
  );
}

export function inheritanceTaxOf(r: EstateTaxResult): number {
  return r.stateInheritanceTax && !r.stateInheritanceTax.inactive
    ? r.stateInheritanceTax.totalTax
    : 0;
}

export function irdTaxOf(r: EstateTaxResult): number {
  return (r.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
}

/**
 * What the Estate Tax page SHOWS as one decedent's total. The engine's
 * `totalTaxesAndExpenses` is federal + state estate + admin; this adds state
 * inheritance tax (informational on the engine, but it is a state death tax)
 * and IRD income tax (which drains heirs, not the estate).
 */
export function displayedTotalTaxesAndExpenses(r: EstateTaxResult): number {
  return r.totalTaxesAndExpenses + inheritanceTaxOf(r) + irdTaxOf(r);
}
