import MoneyText from "@/components/money-text";
import { FEE_COVERAGE_MIN, FEE_COVERAGE_WARN } from "@/lib/investments/proposals/fees";
import type { FeeComparison } from "@/lib/investments/proposals/types";
import { SectionCard, SectionHeading, SectionNote } from "./proposal-section";

const FEES_TOOLTIP =
  "Fund expense ratios come from fund data; the advisory fee is what you entered. Dollar figures apply the all-in rate to the portfolio's current value, so they are a one-year run rate, not a projection.";

/** Coverage is a share of value with a KNOWN expense ratio. Holdings without one
 *  are excluded from the blend, never counted as free, so a low figure means the
 *  blend describes only part of the portfolio. */
function coverageNote(side: string, coveragePct: number, blended: number | null): string | null {
  if (blended === null) {
    return `Expense ratios are known for only ${Math.round(coveragePct * 100)}% of the ${side} holdings' value — below the ${Math.round(FEE_COVERAGE_MIN * 100)}% floor, so no blended figure is shown.`;
  }
  if (coveragePct < FEE_COVERAGE_WARN) {
    return `The ${side} blend covers ${Math.round(coveragePct * 100)}% of value; the rest has no expense ratio on file.`;
  }
  return null;
}

/**
 * Fee rates need finer resolution than `MoneyText`'s single decimal, which
 * rounds a 0.75% advisory fee to "0.8%" and a 0.03% expense ratio to "0.0%" —
 * a comparison of two figures that both read 0.0% is worse than no figure.
 */
const RATE_FMT = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function RatePct({ value }: { value: number | null }) {
  return (
    <span className={`tabular text-[13px] ${value == null ? "text-ink-4" : ""}`}>
      {value == null ? "—" : RATE_FMT.format(value)}
    </span>
  );
}

function FeeRow({
  label,
  current,
  proposed,
}: {
  label: string;
  current: number | null;
  proposed: number | null;
}) {
  return (
    <tr className="border-b border-hair last:border-0">
      <td className="py-1.5 text-[13px] text-ink-2">{label}</td>
      <td className="py-1.5 text-right">
        <RatePct value={current} />
      </td>
      <td className="py-1.5 text-right">
        <RatePct value={proposed} />
      </td>
    </tr>
  );
}

export function ProposalFeesSection({ fees }: { fees: FeeComparison }) {
  const currentNote = coverageNote("current", fees.currentCoveragePct, fees.currentBlendedEr);
  const proposedNote = coverageNote("proposed", fees.proposedCoveragePct, fees.proposedBlendedEr);
  const saved = fees.annualDollarsSaved;

  return (
    <SectionCard>
      <SectionHeading tooltip={FEES_TOOLTIP}>Fees</SectionHeading>

      <table className="w-full">
        <thead>
          <tr className="border-b border-hair-2">
            <th className="pb-2 text-left text-[13px] font-medium text-ink-2">Cost</th>
            <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Current</th>
            <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Proposed</th>
          </tr>
        </thead>
        <tbody>
          <FeeRow
            label="Fund expense ratio (blended)"
            current={fees.currentBlendedEr}
            proposed={fees.proposedBlendedEr}
          />
          <FeeRow
            label="Advisory fee"
            current={fees.advisoryFeeCurrent}
            proposed={fees.advisoryFeeProposed}
          />
          <tr>
            <td className="py-1.5 text-[13px] text-ink-2">All-in cost, per year</td>
            <td className="py-1.5 text-right text-[13px]">
              <MoneyText value={fees.annualDollarsCurrent} format="currency" />
            </td>
            <td className="py-1.5 text-right text-[13px]">
              <MoneyText value={fees.annualDollarsProposed} format="currency" />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 space-y-1">
        {saved === null ? (
          <SectionNote>
            An annual saving needs a blended expense ratio on both sides, so none is shown.
          </SectionNote>
        ) : saved > 0 ? (
          <SectionNote tone="good">
            The proposal costs <MoneyText value={saved} format="currency" /> less per year.
          </SectionNote>
        ) : saved < 0 ? (
          <SectionNote tone="warn">
            The proposal costs <MoneyText value={-saved} format="currency" /> more per year.
          </SectionNote>
        ) : (
          <SectionNote>The two portfolios cost the same per year.</SectionNote>
        )}
        {currentNote && <SectionNote>{currentNote}</SectionNote>}
        {proposedNote && <SectionNote>{proposedNote}</SectionNote>}
      </div>
    </SectionCard>
  );
}
