// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CrtDetailsSection from "../crt-details-section";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";

const baseValue: TrustSplitInterestInput = {
  origin: "new",
  inceptionYear: 2026,
  inceptionValue: 1_000_000,
  payoutType: "unitrust",
  payoutPercent: 0.06,
  irc7520Rate: 0.04,
  termType: "years",
  termYears: 10,
  charityId: "00000000-0000-0000-0000-000000000aaa",
};

const charities = [{ id: "00000000-0000-0000-0000-000000000aaa", name: "Acme Charity" }];

describe("CrtDetailsSection", () => {
  it("renders the CRUT payout field by default and shows charitable deduction preview", () => {
    render(
      <CrtDetailsSection
        value={baseValue}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
        fundingAccounts={[]}
        fundingPicks={[]}
        onFundingPicksChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Payout percentage/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Annual payment/)).not.toBeInTheDocument();
    expect(screen.getByTestId("crt-charitable-deduction").textContent).toMatch(/\$/);
  });

  it("renders the CRAT payout amount when payoutType=annuity", () => {
    const value: TrustSplitInterestInput = {
      ...baseValue,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 60_000,
    };
    render(
      <CrtDetailsSection
        value={value}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
        fundingAccounts={[]}
        fundingPicks={[]}
        onFundingPicksChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Annual payment/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Payout percentage/)).not.toBeInTheDocument();
  });

  it("surfaces a sub-5% payout warning", () => {
    render(
      <CrtDetailsSection
        value={{ ...baseValue, payoutPercent: 0.04 }}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
        fundingAccounts={[]}
        fundingPicks={[]}
        onFundingPicksChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("crt-warnings")).toHaveTextContent(/5% floor/);
  });

  it("surfaces a 10% MRIT warning when remainder is too small", () => {
    render(
      <CrtDetailsSection
        value={{ ...baseValue, payoutPercent: 0.50, termYears: 20 }}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
        fundingAccounts={[]}
        fundingPicks={[]}
        onFundingPicksChange={vi.fn()}
      />,
    );
    const list = screen.getByTestId("crt-warnings");
    expect(list).toHaveTextContent(/minimum remainder/);
  });

  it("does not render warnings list when all checks pass", () => {
    render(
      <CrtDetailsSection
        value={baseValue}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
        fundingAccounts={[]}
        fundingPicks={[]}
        onFundingPicksChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("crt-warnings")).not.toBeInTheDocument();
  });

  it("toggles to existing-origin mode and exposes editable charitable-deduction field", () => {
    const value: TrustSplitInterestInput = {
      ...baseValue,
      origin: "existing",
      originalIncomeInterest: 400_000,
      originalRemainderInterest: 600_000,
    };
    render(
      <CrtDetailsSection
        value={value}
        onChange={vi.fn()}
        familyMembers={[]}
        charities={charities}
      />,
    );
    expect(screen.getByLabelText(/Charitable deduction filed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Income interest \(retained\)/)).toBeInTheDocument();
  });
});
