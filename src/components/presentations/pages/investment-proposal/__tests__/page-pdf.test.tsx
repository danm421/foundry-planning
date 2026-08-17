import { describe, it, expect } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { InvestmentProposalPagePdf } from "../page-pdf";
import { buildInvestmentProposalData } from "@/lib/presentations/pages/investment-proposal/view-model";
import {
  INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
  SECTION_IDS,
} from "@/lib/presentations/pages/investment-proposal/options-schema";
import { estimateInvestmentProposalPageCount } from "@/lib/presentations/pages/investment-proposal/estimate-page-count";
import { BUNDLE } from "@/lib/presentations/pages/investment-proposal/__tests__/fixtures/snapshot";

const OPTIONS = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, proposalId: "p1" };

const INPUT = {
  firmName: "Foundry",
  clientName: "Cooper & Susan Sample",
  reportDate: "August 12, 2026",
  pageIndex: 3,
  totalPages: 20,
  accent: { accent: "#0f7d6c", tint: "#e4f1ec" },
};

/** Flatten every string in a rendered element tree. */
function textOf(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    // A composite element renders lazily; call it to reach its children.
    if (typeof el.type === "function") {
      const rendered = (el.type as (p: unknown) => ReactNode)(el.props);
      return textOf(rendered);
    }
    return Children.toArray(el.props.children).flatMap(textOf);
  }
  return [];
}

const render = (options = OPTIONS, bundle = BUNDLE) =>
  InvestmentProposalPagePdf({ ...INPUT, data: buildInvestmentProposalData(bundle, options) });

const sheetsOf = (el: ReactElement) =>
  Children.toArray((el.props as { children: ReactNode }).children);

describe("InvestmentProposalPagePdf", () => {
  it("prints one page per enabled section", () => {
    const only = {
      ...OPTIONS,
      sections: {
        ...Object.fromEntries(SECTION_IDS.map((k) => [k, false])),
        verdict: true, allocation: true, suitability: true,
      } as typeof OPTIONS.sections,
    };
    expect(sheetsOf(render(only))).toHaveLength(3);
  });

  it("prints the empty state as a single page when nothing is picked", () => {
    const el = InvestmentProposalPagePdf({
      ...INPUT,
      data: buildInvestmentProposalData(undefined, INVESTMENT_PROPOSAL_OPTIONS_DEFAULT),
    });
    expect(sheetsOf(el)).toHaveLength(1);
    expect(textOf(el).join(" ")).toContain("No proposal selected for this page.");
  });

  // The invariant that keeps a deck numbered: `document.tsx` reserves sheets
  // from `estimatePageCount(undefined, options)` and numbers every LATER page
  // from that total. Rendering a different number of `PageFrame`s than were
  // reserved is what mis-numbers the table of contents.
  it.each([
    ["a picked proposal", OPTIONS, BUNDLE],
    ["no proposal picked", INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, undefined],
    ["a proposal that was deleted", OPTIONS, undefined],
  ] as const)("renders exactly the sheets the deck reserved — %s", (_label, options, bundle) => {
    const el = InvestmentProposalPagePdf({
      ...INPUT,
      data: buildInvestmentProposalData(bundle, options),
    });
    expect(sheetsOf(el)).toHaveLength(estimateInvestmentProposalPageCount(undefined, options));
  });

  // Same invariant, one section at a time. The cases above only pin the two
  // ends — every section on and none picked — but what an advisor actually
  // does is switch a single section off, and each one is its own renderer
  // branch.
  it.each(SECTION_IDS)("renders exactly the sheets the deck reserved — without %s", (off) => {
    const options = {
      ...OPTIONS,
      sections: { ...OPTIONS.sections, [off]: false } as typeof OPTIONS.sections,
    };
    const el = InvestmentProposalPagePdf({
      ...INPUT,
      data: buildInvestmentProposalData(BUNDLE, options),
    });
    expect(sheetsOf(el)).toHaveLength(estimateInvestmentProposalPageCount(undefined, options));
  });

  it("says on every reserved sheet when the picked proposal is gone", () => {
    const el = InvestmentProposalPagePdf({
      ...INPUT,
      data: buildInvestmentProposalData(undefined, OPTIONS),
    });
    expect(textOf(el).join(" ")).toContain("no longer available");
  });

  it("puts the headline recommendation on the verdict page", () => {
    expect(textOf(render()).join(" ")).toContain("Earned back in about 5.7 years");
  });

  it("names the client's documented rung and both estimated placements", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("Moderate");
    expect(text).toContain("Conservative");
    expect(text).toContain("Moderately Aggressive");
  });

  it("says outright when the proposal does not sit on the documented rung", () => {
    expect(textOf(render()).join(" ")).toContain(
      "The proposed portfolio does not sit on the client's documented rung.",
    );
  });
});

describe("InvestmentProposalPagePdf — detail sections", () => {
  it("prints the fee comparison with both blended expense ratios", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("0.23%");
    expect(text).toContain("0.10%");
    expect(text).toContain("$243");
  });

  it("names an unavailable stress window and why, rather than dropping it", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("Global financial crisis");
    expect(text).toContain("One or more holdings launched after this period.");
  });

  it("prints the realized loss for an available stress window", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("COVID crash");
    expect(text).toContain("-20.5%");
    expect(text).toContain("-15.9%");
  });

  it("puts a negative dollar's minus sign before the currency symbol", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("-$37,973");
    expect(text).not.toContain("$-37,973");
  });

  it("prints the tax cost and the break-even together, never the benefit alone", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("$36,911");
    expect(text).toContain("5.7");
  });

  it("lists every proposed holding with its weight and expense ratio", () => {
    const text = textOf(render()).join(" ");
    for (const t of ["VTI", "GLD", "VOO"]) expect(text).toContain(t);
    expect(text).toContain("0.03%");
  });

  it("shows the growth-of-$100,000 endpoints from the frozen backtest", () => {
    const text = textOf(render()).join(" ");
    expect(text).toContain("$137,000");
    expect(text).toContain("$189,000");
  });

  it("labels the outcome cone as portfolio-only, never as plan confidence", () => {
    expect(textOf(render()).join(" ")).toContain(
      "Portfolio growth only — this is not the plan's probability of success.",
    );
  });
});

// The two reasons a realized block goes missing print DIFFERENT copy, and the
// difference is the whole point: a short window means the holdings have not
// existed together for long, suppressed coverage means a large slice of the
// money — usually cash — has no price history at all. Naming the wrong one
// points an advisor at the wrong fix. Rendered against Cooper's real 46%-cash
// account on 2026-08-17; these lock what was seen on the sheet.
describe("InvestmentProposalPagePdf — a withheld realized block", () => {
  /** Only these sections, so an assertion cannot be satisfied by another sheet. */
  const only = (...ids: (typeof SECTION_IDS)[number][]) => ({
    ...OPTIONS,
    sections: {
      ...Object.fromEntries(SECTION_IDS.map((k) => [k, false])),
      ...Object.fromEntries(ids.map((k) => [k, true])),
    } as typeof OPTIONS.sections,
  });

  const SUPPRESSED_STRESS_REASON =
    "Too little of the portfolio has price history to show how it would have fared.";
  const LAUNCH_DATE_REASON = "One or more holdings launched after this period.";

  /**
   * A bundle with no realized block at all — the shape `assemble` + `snapshot`
   * produce for either cause. `coverageSuppressed` is what the sheets branch on.
   */
  const noRealized = (coverageSuppressed: boolean, reason: string): typeof BUNDLE => ({
    ...BUNDLE,
    snapshot: {
      ...BUNDLE.snapshot,
      backtest: null,
      stress: BUNDLE.snapshot.stress.map((w) => ({
        ...w,
        available: false,
        unavailableReason: reason,
        currentReturn: null, proposedReturn: null,
        currentDrawdown: null, proposedDrawdown: null,
        currentDollars: null, proposedDollars: null,
      })),
      compute: {
        ...BUNDLE.snapshot.compute,
        current: { ...BUNDLE.snapshot.compute.current, realized: null },
        proposed: { ...BUNDLE.snapshot.compute.proposed, realized: null },
        realizedWindow: {
          ...BUNDLE.snapshot.compute.realizedWindow,
          insufficientHistory: !coverageSuppressed,
          coverageSuppressed,
        },
      },
    },
  });

  /** Either side under REALIZED_COVERAGE_MIN — Cooper's 46%-cash taxable account. */
  const suppressed = noRealized(true, SUPPRESSED_STRESS_REASON);
  /** A long-enough window is available, the holdings just have not shared it. */
  const shortWindow = noRealized(false, LAUNCH_DATE_REASON);

  const growthText = (bundle: typeof BUNDLE) =>
    textOf(render(only("growth"), bundle)).join(" ");
  const stressText = (bundle: typeof BUNDLE) =>
    textOf(render(only("stress"), bundle)).join(" ");

  it("blames thin coverage, not a short window, when coverage is suppressed", () => {
    const text = growthText(suppressed);
    expect(text).toContain("Too little of the portfolio has price history to trace a realized");
    expect(text).not.toContain("share too little price history");
  });

  it("blames the short window when that — not coverage — is the reason", () => {
    const text = growthText(shortWindow);
    expect(text).toContain("The two portfolios share too little price history");
    expect(text).not.toContain("money-market and sweep positions");
  });

  // Suppression empties every stress window at once. A subtitle promising a
  // comparison and a header row over zero rows both claim a sheet that isn't
  // there — the same misread GrowthSection already avoids.
  it.each([
    ["suppressed coverage", () => stressText(suppressed)],
    ["a short shared window", () => stressText(shortWindow)],
  ])("drops the stress subtitle and column headers under %s", (_label, text) => {
    const t = text();
    expect(t).toContain("Not available");
    expect(t).not.toContain("How each portfolio behaved in past declines");
    expect(t).not.toContain("Current $");
    expect(t).not.toContain("Proposed $");
  });

  it("keeps the subtitle and headers whenever a stress window IS computable", () => {
    const t = stressText(BUNDLE);
    expect(t).toContain("How each portfolio behaved in past declines");
    expect(t).toContain("Current $");
    expect(t).not.toContain("Not available");
  });

  it("states the one suppression cause once, not once per window", () => {
    const t = stressText(suppressed);
    expect(t).toContain("Too little of the portfolio has price history to show how it would have");
    expect(t.split(SUPPRESSED_STRESS_REASON.slice(0, 40)).length - 1).toBe(1);
    // The per-window labels belong to the OTHER branch; three identical
    // sentences read as three separate problems.
    expect(t).not.toContain("Global financial crisis");
  });

  it("still names every window when they fail for their own reasons", () => {
    const t = stressText(shortWindow);
    for (const label of ["Global financial crisis", "COVID crash"]) expect(t).toContain(label);
    expect(t).toContain(LAUNCH_DATE_REASON);
  });
});
