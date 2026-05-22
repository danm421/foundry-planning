// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CltDetailsSection from "../clt-details-section";

const baseProps = {
  value: {
    origin: "new" as const,
    inceptionYear: 2026,
    inceptionValue: 1_000_000,
    payoutType: "unitrust" as const,
    payoutPercent: 0.06,
    irc7520Rate: 0.022,
    termType: "years" as const,
    termYears: 10,
    charityId: "ch1",
  },
  onChange: () => {},
  familyMembers: [
    { id: "fm1", firstName: "Alice", dateOfBirth: "1960-01-01" },
  ],
  charities: [{ id: "ch1", name: "Acme Foundation" }],
};

describe("<CltDetailsSection>", () => {
  it("renders the unitrust input fields", () => {
    render(<CltDetailsSection {...baseProps} />);
    expect(screen.getByLabelText(/inception year/i)).toBeInTheDocument();
    // For origin = 'new', funding-year FMV is now a disclosure dropdown — the label associates with the trigger button.
    expect(
      screen.getByRole("button", { name: /funding-year fmv/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/payout percentage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/7520 rate/i)).toBeInTheDocument();
  });

  it("displays the live computed income/remainder preview matching eMoney example", () => {
    render(<CltDetailsSection {...baseProps} />);
    expect(screen.getByTestId("clt-income-interest").textContent).toMatch(/461,385/);
    expect(screen.getByTestId("clt-remainder-interest").textContent).toMatch(/538,615/);
  });

  it("renders origin radios with 'new' selected by default", () => {
    render(<CltDetailsSection {...baseProps} />);
    const newBtn = screen.getByRole("radio", { name: /new \(funded in plan\)/i });
    const existingBtn = screen.getByRole("radio", {
      name: /existing \(already funded\)/i,
    });
    expect(newBtn).toHaveAttribute("aria-checked", "true");
    expect(existingBtn).toHaveAttribute("aria-checked", "false");
  });

  it("hides the computed preview and shows manual income/remainder inputs when origin = 'existing'", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          origin: "existing",
          originalIncomeInterest: 461_385,
          originalRemainderInterest: 538_615,
        }}
      />,
    );
    expect(screen.queryByTestId("clt-income-interest")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/income interest \(deduction taken\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/remainder interest \(gift filed\)/i),
    ).toBeInTheDocument();
  });

  it("calls onChange with origin='existing' when the existing radio is clicked", () => {
    const onChange = vi.fn();
    render(<CltDetailsSection {...baseProps} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("radio", { name: /existing \(already funded\)/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "existing" }),
    );
  });

  it("hides termYears when termType = 'single_life'", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          termType: "single_life",
          termYears: undefined,
          measuringLife1Id: "fm1",
        }}
      />,
    );
    expect(screen.queryByLabelText(/term years/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/measuring life 1/i)).toBeInTheDocument();
  });

  it("shows two measuring-life selects when termType = 'joint_life'", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          termType: "joint_life",
          termYears: undefined,
          measuringLife1Id: "fm1",
          measuringLife2Id: "fm2",
        }}
        familyMembers={[
          { id: "fm1", firstName: "Alice", dateOfBirth: "1960-01-01" },
          { id: "fm2", firstName: "Bob", dateOfBirth: "1962-01-01" },
        ]}
      />,
    );
    expect(screen.getByLabelText(/measuring life 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/measuring life 2/i)).toBeInTheDocument();
  });

  it("renders a manual FMV input (no picker) when origin = 'existing'", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          origin: "existing",
          originalIncomeInterest: 461_385,
          originalRemainderInterest: 538_615,
        }}
      />,
    );
    expect(screen.getByLabelText(/fmv at original funding/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /funding-year fmv/i }),
    ).toBeNull();
  });
});

describe("<CltDetailsSection> subtype toggle (CLUT/CLAT)", () => {
  it("defaults to CLUT (unitrust) on new entity and shows payout percent field", () => {
    render(<CltDetailsSection {...baseProps} />);
    expect(screen.getByRole("radio", { name: /^CLUT$/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /^CLAT$/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByLabelText(/payout percentage/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("clicking CLAT calls onChange with payoutType='annuity' and clears payoutPercent", () => {
    const onChange = vi.fn();
    render(<CltDetailsSection {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /^CLAT$/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutType: "annuity",
        payoutPercent: undefined,
      }),
    );
  });

  it("renders annual payment field (and no percent field) when payoutType is annuity", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          payoutType: "annuity",
          payoutPercent: undefined,
          payoutAmount: 60_000,
        }}
      />,
    );
    expect(screen.getByLabelText(/annual payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/payout percentage/i)).not.toBeInTheDocument();
  });

  it("disables CLUT/CLAT radios when editing an existing trust (origin='existing')", () => {
    render(
      <CltDetailsSection
        {...baseProps}
        value={{
          ...baseProps.value,
          origin: "existing",
          originalIncomeInterest: 461_385,
          originalRemainderInterest: 538_615,
        }}
      />,
    );
    expect(screen.getByRole("radio", { name: /^CLUT$/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^CLAT$/i })).toBeDisabled();
  });
});
