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
});
