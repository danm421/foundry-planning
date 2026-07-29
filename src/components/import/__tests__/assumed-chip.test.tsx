// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import AssumedChip from "../assumed-chip";
import type { AssembleAssumption } from "@/lib/imports/assemble/types";

const ASSUMPTION: AssembleAssumption = {
  field: "client.filingStatus",
  value: "single",
  reason: "No filing status found in the source documents; defaulted to Single.",
};

describe("AssumedChip", () => {
  it("renders nothing when there is no assumption for the field", () => {
    const { container } = render(<AssumedChip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the Assumed label when an assumption is supplied", () => {
    render(<AssumedChip assumption={ASSUMPTION} />);
    expect(screen.getByText("Assumed")).toBeInTheDocument();
  });

  it("exposes the assumption's reason through the tooltip", () => {
    render(<AssumedChip assumption={ASSUMPTION} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent(ASSUMPTION.reason);
  });

  it("renders an estimated value distinctly from a document value", () => {
    const { container } = render(
      <AssumedChip
        assumption={{
          field: "goal.education.ucsb",
          value: 41000,
          provenance: "estimated",
          reason: "Model estimate of UCSB cost.",
        }}
      />,
    );
    expect(container.textContent).toMatch(/estimate/i);
    expect(container.textContent).toMatch(/verify/i);
  });

  it("does not label a document-sourced value as an estimate", () => {
    const { container } = render(
      <AssumedChip
        assumption={{
          field: "client.age",
          value: 64,
          provenance: "document",
          reason: "Stated in the Profile table.",
        }}
      />,
    );
    expect(screen.getByTestId("assumed-chip")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/estimate/i);
  });

  it("shows the reason for a normalized value", () => {
    render(
      <AssumedChip
        assumption={{
          field: "client.retirementAge",
          value: 2049,
          provenance: "derived",
          reason:
            "Ends at the spouse's retirement. The document stated age 95, which appears to be a data-entry error.",
        }}
      />,
    );
    expect(screen.getByText(/data-entry error/)).toBeInTheDocument();
  });
});
