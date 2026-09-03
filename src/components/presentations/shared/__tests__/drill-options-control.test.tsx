// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DrillOptionsControl, TaxBracketOptionsControl } from "../drill-options-control";

const value = { range: "full" as const, showCallout: false };

describe("DrillOptionsControl", () => {
  it("offers Full and Custom only", () => {
    render(<DrillOptionsControl value={value} onChange={() => {}} />);
    expect(screen.getByLabelText("Full")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom")).toBeInTheDocument();
    expect(screen.queryByLabelText("Roth conversion years")).not.toBeInTheDocument();
  });
});

describe("TaxBracketOptionsControl", () => {
  it("adds the Roth conversion years range", () => {
    render(<TaxBracketOptionsControl value={value} onChange={() => {}} />);
    expect(screen.getByLabelText("Roth conversion years")).toBeInTheDocument();
  });
});
