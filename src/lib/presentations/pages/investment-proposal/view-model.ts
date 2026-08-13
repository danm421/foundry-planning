// Frozen snapshot + options → everything the PDF prints. Pure and synchronous:
// `buildData` runs inside the document tree, so all IO already happened in the
// export route.
//
// Nothing here recomputes. Every figure is read off the snapshot; the only
// arithmetic is a difference between two frozen numbers, which is still a
// statement about the frozen pair.
import {
  printedSections,
  type InvestmentProposalOptions,
  type ProposalSectionId,
} from "./options-schema";
import { buildProposalDonutSpec, buildProposalScatterSpec } from "./charts";
import type { InvestmentProposalBundle } from "@/lib/presentations/investment-proposal-bundle";
import type { DonutSpec, ScatterSpec } from "@/lib/presentations/charts/types";
import type { ProposalSnapshot, StressWindow } from "@/lib/investments/proposals/types";

export interface ProposalVerdict {
  deltaReturn: number;
  deltaVolatility: number;
  deltaSharpe: number | null;
  estimatedTax: number;
  annualDollarsSaved: number | null;
  headline: string;
}

export interface InvestmentProposalPageData {
  isEmpty: boolean;
  emptyMessage: string;
  title: string;
  subtitle: string;
  asOf: string;
  sections: ProposalSectionId[];
  verdict: ProposalVerdict;
  donuts: { current: DonutSpec; proposed: DonutSpec };
  scatter: ScatterSpec;
  stress: {
    available: StressWindow[];
    unavailable: { label: string; reason: string }[];
  };
  commentary: string;
  /** The whole frozen artifact, for the sections that print it verbatim. */
  snapshot: ProposalSnapshot | null;
}

const EMPTY_DONUT: DonutSpec = { kind: "donut", size: 150, rings: [{ segments: [] }], legend: [] };

const EMPTY: Omit<InvestmentProposalPageData, "emptyMessage"> = {
  isEmpty: true,
  title: "Investment Proposal",
  subtitle: "",
  asOf: "",
  sections: [],
  verdict: {
    deltaReturn: 0, deltaVolatility: 0, deltaSharpe: null,
    estimatedTax: 0, annualDollarsSaved: null, headline: "",
  },
  donuts: { current: EMPTY_DONUT, proposed: EMPTY_DONUT },
  scatter: buildProposalScatterSpec(
    { arithmeticMean: 0, geometricReturn: 0, stdDev: 0, sharpe: null },
    { arithmeticMean: 0, geometricReturn: 0, stdDev: 0, sharpe: null },
  ),
  stress: { available: [], unavailable: [] },
  commentary: "",
  snapshot: null,
};

/** The one sentence the whole report is arguing. Written from `breakEven`,
 *  whose verdict already encodes every case the analytics layer distinguishes. */
function headlineFor(snapshot: ProposalSnapshot): string {
  const { verdict, years } = snapshot.breakEven;
  switch (verdict) {
    case "recovered":
      return `Earned back in about ${years!.toFixed(1)} years — the tax cost is expected to be recovered within the horizon shown.`;
    case "beyond_horizon":
      return "The tax cost is not expected to be earned back within the horizon shown.";
    case "no_benefit":
      return "No break-even — the proposal is not expected to out-earn the current portfolio after fees, so the tax cost is never earned back.";
    case "no_tax_cost":
      return "No tax cost to switch — the proposal's advantage starts immediately.";
  }
}

export function buildInvestmentProposalData(
  bundle: InvestmentProposalBundle | undefined,
  options: InvestmentProposalOptions,
): InvestmentProposalPageData {
  if (!bundle) {
    // Two different empty states, deliberately. "Nothing picked" is a builder
    // step the advisor hasn't taken; "no longer available" is a proposal that
    // was deleted after the deck was saved, and saying so is what stops an
    // advisor re-exporting the same blank page twice looking for the bug.
    return {
      ...EMPTY,
      emptyMessage:
        options.proposalId === ""
          ? "No proposal selected for this page."
          : "The proposal this page pointed at is no longer available. Pick another in the builder.",
    };
  }

  const s = bundle.snapshot;
  const cur = s.compute.current;
  const prop = s.compute.proposed;

  return {
    isEmpty: false,
    emptyMessage: "",
    title: bundle.name,
    subtitle: bundle.targetLabel,
    asOf: bundle.computedAt,
    sections: printedSections(options),
    verdict: {
      deltaReturn: prop.cma.geometricReturn - cur.cma.geometricReturn,
      deltaVolatility: prop.cma.stdDev - cur.cma.stdDev,
      deltaSharpe:
        prop.cma.sharpe === null || cur.cma.sharpe === null
          ? null
          : prop.cma.sharpe - cur.cma.sharpe,
      estimatedTax: s.compute.tax.estimatedTax,
      annualDollarsSaved: s.fees.annualDollarsSaved,
      headline: headlineFor(s),
    },
    donuts: {
      current: buildProposalDonutSpec(cur.assetMix, "Current"),
      proposed: buildProposalDonutSpec(prop.assetMix, "Proposed"),
    },
    scatter: buildProposalScatterSpec(cur.cma, prop.cma),
    stress: {
      available: s.stress.filter((w) => w.available),
      unavailable: s.stress
        .filter((w) => !w.available)
        .map((w) => ({ label: w.label, reason: w.unavailableReason ?? "No data for this window." })),
    },
    commentary: options.ai.generatedText,
    snapshot: s,
  };
}
