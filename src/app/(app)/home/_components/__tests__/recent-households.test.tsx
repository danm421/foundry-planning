// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentHouseholds } from "../recent-households";

const ROWS = [
  { id: "h1", name: "Cooper & Susan Sample", status: "prospect", hasPlanningClient: false, lastOpenedAt: null },
  { id: "h2", name: "Dan Mueller", status: "active", hasPlanningClient: true, lastOpenedAt: null },
];

describe("RecentHouseholds", () => {
  it("renders each status as a chip", () => {
    render(<RecentHouseholds households={ROWS} />);
    expect(screen.getByText("prospect").className).toContain("chip");
    expect(screen.getByText("active").className).toContain("chip");
  });

  it("keeps the empty state", () => {
    render(<RecentHouseholds households={[]} />);
    expect(screen.getByText("Households you open will show up here.")).toBeInTheDocument();
  });
});
