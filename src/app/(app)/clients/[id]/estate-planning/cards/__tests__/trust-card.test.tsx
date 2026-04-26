// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TrustCard } from "../trust-card";
import type { TrustCardData } from "../../lib/derive-card-data";

const data: TrustCardData = {
  entityId: "e1",
  name: "Tom's SLAT",
  subType: "slat",
  isIrrevocable: true,
  grantorRole: "client",
  trusteeName: "Sarah Smith",
  heldAssets: [
    { id: "a3", name: "SLAT Brokerage", category: "taxable", tag: "TAX", value: 2_400_000 },
  ],
  totalValue: 2_400_000,
  exemptionConsumed: 2_400_000,
  exemptionAvailable: 15_000_000,
};

describe("TrustCard", () => {
  it("renders collapsed with name, sub-type pill, and asset count", () => {
    render(<TrustCard data={data} />);
    expect(screen.getByText("Tom's SLAT")).toBeInTheDocument();
    expect(screen.getAllByText(/slat/i)).toHaveLength(2); // name and pill
    expect(screen.getByText(/1 asset/i)).toBeInTheDocument();
  });

  it("expands and shows trustee + held assets + exemption footer", () => {
    render(<TrustCard data={data} defaultExpanded />);
    expect(screen.getByText("SLAT Brokerage")).toBeInTheDocument();
    expect(screen.getByText(/Sarah Smith/i)).toBeInTheDocument();
    expect(screen.getAllByText(/2,400,000/)).toHaveLength(3); // header, asset row, and exemption footer
    expect(screen.getByText(/15,000,000/)).toBeInTheDocument();
  });

  it("toggles expanded state on click", () => {
    render(<TrustCard data={data} />);
    expect(screen.queryByText("SLAT Brokerage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tom's SLAT/i }));
    expect(screen.getByText("SLAT Brokerage")).toBeInTheDocument();
  });
});
