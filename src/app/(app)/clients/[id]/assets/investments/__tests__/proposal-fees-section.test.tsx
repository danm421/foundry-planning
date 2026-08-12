// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProposalFeesSection } from "../proposal-fees-section";
import type { FeeComparison } from "@/lib/investments/proposals/types";

const fees = (over: Partial<FeeComparison> = {}): FeeComparison => ({
  currentBlendedEr: 0.008,
  proposedBlendedEr: 0.0003,
  currentCoveragePct: 1,
  proposedCoveragePct: 1,
  advisoryFeeCurrent: 0.01,
  advisoryFeeProposed: 0.0075,
  annualDollarsCurrent: 18_000,
  annualDollarsProposed: 7_800,
  annualDollarsSaved: 10_200,
  ...over,
});

describe("ProposalFeesSection", () => {
  it("keeps two decimals so a 0.75% fee isn't rounded to 0.8%", () => {
    render(<ProposalFeesSection fees={fees()} />);
    expect(screen.getByText("0.75%")).toBeInTheDocument();
    // A 3-basis-point expense ratio must not collapse to "0.0%".
    expect(screen.getByText("0.03%")).toBeInTheDocument();
    expect(screen.getByText("1.00%")).toBeInTheDocument();
  });

  it("names the coverage floor instead of showing a blend it can't support", () => {
    render(
      <ProposalFeesSection
        fees={fees({
          currentBlendedEr: null,
          currentCoveragePct: 0.4,
          annualDollarsCurrent: null,
          annualDollarsSaved: null,
        })}
      />,
    );
    expect(screen.getByText(/only 40% of the current holdings' value/)).toBeInTheDocument();
    expect(screen.getByText(/below the 50% floor/)).toBeInTheDocument();
    expect(screen.getByText(/annual saving needs a blended expense ratio on both sides/)).toBeInTheDocument();
  });
});
