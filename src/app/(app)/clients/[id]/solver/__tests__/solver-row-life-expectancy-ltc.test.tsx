// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SolverRowLifeExpectancy } from "../solver-row-life-expectancy";
import { baseClient } from "@/engine/__tests__/fixtures";

afterEach(cleanup);

const couple = { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 93 };

describe("life-expectancy row under an LTC event", () => {
  it("says what the LTC stress test sets the client's life expectancy to, and only the client's", () => {
    // John (1970) in care 2055–2057: the row still shows the plan's 95 above it.
    const john = { person: "client" as const, startAge: 85, years: 3, careSetting: "nursing_private" as const,
      annualCost: 129_575, costInflation: 0.05, startYear: 2055, endYear: 2057 };
    render(
      <SolverRowLifeExpectancy
        baseClient={couple}
        workingClient={couple}
        onChange={vi.fn()}
        ltcPeople={[john]}
      />,
    );
    expect(screen.getAllByText(/by the long-term care stress test\./)).toHaveLength(1);
    expect(screen.getByText("Set to 87 (2057) by the long-term care stress test.")).toBeTruthy();
  });

  it("says nothing without an LTC event", () => {
    render(<SolverRowLifeExpectancy baseClient={couple} workingClient={couple} onChange={vi.fn()} />);
    expect(screen.queryByText(/by the long-term care stress test/)).toBeNull();
  });
});
