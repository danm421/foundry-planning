import MoneyText from "@/components/money-text";
import { MAX_BREAK_EVEN_YEARS } from "@/lib/investments/proposals/break-even";
import type { BreakEvenResult, BreakEvenVerdict } from "@/lib/investments/proposals/types";
import { SectionCard, SectionHeading, SectionNote } from "./proposal-section";

const BREAK_EVEN_TOOLTIP =
  "How long the tax cost of switching takes to earn back, at the proposal's expected return advantage plus its fee saving. An expectation drawn from capital-market assumptions — not a promise, and not a guarantee of any year count.";

const VERDICT: Record<BreakEvenVerdict, { tone: "good" | "warn"; body: string }> = {
  recovered: {
    tone: "good",
    body: "The tax cost is expected to be earned back within the horizon shown.",
  },
  beyond_horizon: {
    tone: "warn",
    body: `At the expected annual benefit the tax cost takes longer than ${MAX_BREAK_EVEN_YEARS} years to earn back, which is too far out to put in front of a client.`,
  },
  no_benefit: {
    tone: "warn",
    body: "The proposal is not expected to out-earn the current portfolio after fees, so the tax cost is never earned back.",
  },
  no_tax_cost: {
    tone: "good",
    body: "Moving these holdings realizes no taxable gain, so there is nothing to earn back.",
  },
};

function headline(breakEven: BreakEvenResult): string {
  switch (breakEven.verdict) {
    case "recovered":
      // `years` is non-null for this verdict by construction; fall back on the
      // wording rather than asserting, so a future verdict change can't crash.
      return breakEven.years == null
        ? "Earned back within the horizon"
        : `Earned back in about ${breakEven.years.toFixed(1)} years`;
    case "beyond_horizon":
      return `Beyond ${MAX_BREAK_EVEN_YEARS} years`;
    case "no_benefit":
      return "No break-even";
    case "no_tax_cost":
      return "No tax cost to earn back";
  }
}

function Figure({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: "currency" | "years";
}) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 text-[15px] text-ink">
        {format === "currency" ? (
          <MoneyText value={value} format="currency" />
        ) : (
          <span className="tabular text-[15px]">
            {value == null ? <span className="text-ink-4">—</span> : `${value.toFixed(1)} yrs`}
          </span>
        )}
      </p>
    </div>
  );
}

export function ProposalBreakEvenSection({ breakEven }: { breakEven: BreakEvenResult }) {
  const verdict = VERDICT[breakEven.verdict];

  return (
    <SectionCard>
      <SectionHeading tooltip={BREAK_EVEN_TOOLTIP}>Transition break-even</SectionHeading>

      <p
        className={`text-[15px] font-medium ${verdict.tone === "good" ? "text-good" : "text-warn"}`}
      >
        {headline(breakEven)}
      </p>
      <div className="mt-1">
        <SectionNote tone={verdict.tone}>{verdict.body}</SectionNote>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-hair-2 pt-4 sm:grid-cols-3">
        <Figure label="Estimated tax to switch" value={breakEven.estimatedTax} format="currency" />
        <Figure
          label="Expected benefit, per year"
          value={breakEven.annualBenefit}
          format="currency"
        />
        <Figure label="Years to break even" value={breakEven.years} format="years" />
      </div>
    </SectionCard>
  );
}
