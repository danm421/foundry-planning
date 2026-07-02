// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnalysisYearTable, type YearTableColumn } from "../year-table";

interface Row {
  year: number;
  value: number;
}

const rows: Row[] = [
  { year: 2030, value: 42_000 },
  { year: 2031, value: 0 },
];

const columns: YearTableColumn<Row>[] = [
  { key: "year", header: "Year", render: (r) => r.year },
  {
    key: "value",
    header: "Value",
    align: "right",
    render: (r) => `$${r.value.toLocaleString()}`,
    drill: (r) =>
      r.value > 0
        ? {
            title: `Value — ${r.year}`,
            total: r.value,
            groups: [{ rows: [{ id: "a", label: "Item A", amount: r.value }] }],
          }
        : null,
  },
];

describe("AnalysisYearTable cell drill", () => {
  it("renders a drillable cell as a button and opens the modal on click", () => {
    render(<AnalysisYearTable rows={rows} columns={columns} />);
    const btn = screen.getByRole("button", { name: "$42,000" });
    fireEvent.click(btn);
    expect(screen.getByText("Value — 2030")).toBeTruthy();
    expect(screen.getByText("Item A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Value — 2030")).toBeNull();
  });

  it("renders plain text when drill returns null or is not set", () => {
    render(<AnalysisYearTable rows={rows} columns={columns} />);
    // year cells (no drill) and the zero-value cell (drill → null): no buttons
    expect(screen.queryByRole("button", { name: "2030" })).toBeNull();
    expect(screen.queryByRole("button", { name: "$0" })).toBeNull();
    expect(screen.getByText("$0")).toBeTruthy();
  });
});
