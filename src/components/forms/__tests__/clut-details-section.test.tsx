// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ClutDetailsSection from "../clut-details-section";

const baseProps = {
  value: {
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

describe("<ClutDetailsSection>", () => {
  it("renders the unitrust input fields", () => {
    render(<ClutDetailsSection {...baseProps} />);
    expect(screen.getByLabelText(/inception year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fmv at funding/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/payout percentage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/7520 rate/i)).toBeInTheDocument();
  });

  it("displays the live computed income/remainder preview matching eMoney example", () => {
    render(<ClutDetailsSection {...baseProps} />);
    expect(screen.getByTestId("clut-income-interest").textContent).toMatch(/461,385/);
    expect(screen.getByTestId("clut-remainder-interest").textContent).toMatch(/538,615/);
  });

  it("hides termYears when termType = 'single_life'", () => {
    render(
      <ClutDetailsSection
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
      <ClutDetailsSection
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
});
