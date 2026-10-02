// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SolverRowLifeExpectancy } from "../solver-row-life-expectancy";
import { baseClient } from "@/engine/__tests__/fixtures";

afterEach(cleanup);

const couple = { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 93 };

describe("life-expectancy row under an LTC event", () => {
  it("says the LTC stress test sets the client's life expectancy, and only the client's", () => {
    render(
      <SolverRowLifeExpectancy
        baseClient={couple}
        workingClient={couple}
        onChange={vi.fn()}
        ltcPeople={["client"]}
      />,
    );
    expect(screen.getAllByText("Set by the long-term care stress test.")).toHaveLength(1);
  });

  it("says nothing without an LTC event", () => {
    render(<SolverRowLifeExpectancy baseClient={couple} workingClient={couple} onChange={vi.fn()} />);
    expect(screen.queryByText("Set by the long-term care stress test.")).toBeNull();
  });
});
