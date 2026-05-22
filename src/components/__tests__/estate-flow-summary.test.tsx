// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EstateFlowSummaryView } from "../estate-flow-summary";
import type { EstateFlowSummary } from "@/lib/estate/estate-flow-summary";

function fixture(): EstateFlowSummary {
  return {
    spouseNetWorth: { ownerLabel: "Susan", amount: 573_284 },
    firstDeath: {
      decedentLabel: "Cooper's Estate",
      year: 2028,
      estateValue: 2_195_105,
      estateLines: [],
      subBoxes: [
        { kind: "taxes", label: "Taxes & Expenses", total: -3_900, lines: [] },
        { kind: "trusts", label: "Trusts", total: 50_000, lines: [] },
        {
          kind: "inheritance_spouse",
          label: "Inheritance",
          total: 2_141_205,
          lines: [],
          targetLabel: "Susan's Estate",
        },
      ],
    },
    secondDeath: {
      decedentLabel: "Susan's Estate",
      year: 2032,
      estateValue: 1_967_668,
      estateLines: [],
      subBoxes: [
        { kind: "taxes", label: "Taxes & Expenses", total: -285_754, lines: [] },
        { kind: "heirs_outright", label: "Heirs", total: 1_681_914, lines: [] },
      ],
    },
    outOfEstate: {
      heirs: { total: 30_000, entities: [] },
      irrevTrusts: { total: 150_000, entities: [] },
    },
    heirBoxes: [
      {
        recipientKey: "kevin",
        recipientLabel: "Kevin Sample",
        outright: 840_957,
        inTrust: 200_000,
        total: 1_040_957,
        sections: [],
        recipientGroups: { firstDeath: null, secondDeath: null },
        trustInterests: [],
      },
      {
        recipientKey: "caroline",
        recipientLabel: "Caroline Sample",
        outright: 870_957,
        inTrust: 0,
        total: 870_957,
        sections: [],
        recipientGroups: { firstDeath: null, secondDeath: null },
        trustInterests: [],
      },
    ],
    totals: { totalTaxesAndExpenses: -289_654, totalToHeirs: 1_911_914 },
  };
}

describe("EstateFlowSummaryView", () => {
  it("renders headline boxes for both deaths + OOE groups + heir boxes", () => {
    render(<EstateFlowSummaryView summary={fixture()} />);
    expect(screen.getByText(/Cooper's Estate/)).toBeInTheDocument();
    expect(screen.getByText(/Susan's Estate/)).toBeInTheDocument();
    expect(screen.getAllByText(/Heirs/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Irrev Trusts/)).toBeInTheDocument();
    expect(screen.getByText(/Kevin Sample/)).toBeInTheDocument();
    expect(screen.getByText(/Caroline Sample/)).toBeInTheDocument();
  });

  it("opens the side panel when a box is clicked, closes on Escape", () => {
    render(<EstateFlowSummaryView summary={fixture()} />);
    fireEvent.click(screen.getByText(/Cooper's Estate/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the empty-state message when summary is null", () => {
    render(<EstateFlowSummaryView summary={null} />);
    expect(screen.getByText(/No estate flow to show/)).toBeInTheDocument();
  });
});
