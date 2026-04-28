// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TrustCard } from "../trust-card";
import type { TrustCardData } from "../../lib/derive-card-data";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({
    isOver: false,
    setNodeRef: () => undefined,
  }),
}));

const data: TrustCardData = {
  entityId: "e1",
  name: "Tom's SLAT",
  subType: "slat",
  isIrrevocable: true,
  grantorRole: "client",
  trusteeName: "Sarah Smith",
  rows: [
    {
      accountId: "a3",
      accountName: "SLAT Brokerage",
      category: "taxable",
      taxTag: "TAX",
      ownerPercent: 1,
      sliceValue: 2_400_000,
      hasMultipleOwners: false,
      coOwners: [],
    },
  ],
  total: 2_400_000,
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

  it("does not render a remove button when onRemoveSlice is not provided", () => {
    render(<TrustCard data={data} defaultExpanded />);
    expect(screen.queryByRole("button", { name: /remove slice/i })).not.toBeInTheDocument();
  });

  it("renders a remove button on each row that calls onRemoveSlice", async () => {
    const onRemoveSlice = vi.fn();
    render(<TrustCard data={data} defaultExpanded onRemoveSlice={onRemoveSlice} />);
    const removeBtn = screen.getAllByRole("button", { name: /remove slice/i })[0];
    await userEvent.click(removeBtn);
    expect(onRemoveSlice).toHaveBeenCalledWith({
      accountId: data.rows[0].accountId,
      trustEntityId: data.entityId,
    });
  });
});
