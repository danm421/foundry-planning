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
  // TODO(task 8): drop this and use OPTIONS once `commentary` renders too.
  const IMPLEMENTED = {
    ...OPTIONS,
    sections: { ...OPTIONS.sections, commentary: false },
  };

  it.each([
    ["a picked proposal", IMPLEMENTED, BUNDLE],
    ["no proposal picked", INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, undefined],
    ["a proposal that was deleted", OPTIONS, undefined],
  ] as const)("renders exactly the sheets the deck reserved — %s", (_label, options, bundle) => {
    const el = InvestmentProposalPagePdf({
      ...INPUT,
      data: buildInvestmentProposalData(bundle, options),
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
