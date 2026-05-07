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

const baseRow = {
  accountId: "a3",
  accountName: "SLAT Brokerage",
  category: "taxable" as const,
  taxTag: "TAX" as const,
  ownerPercent: 1,
  sliceValue: 2_400_000,
  linkedLiabilityBalance: 0,
  netSliceValue: 2_400_000,
  hasMultipleOwners: false,
  coOwners: [],
};

function makeTrustCardData(overrides: Partial<TrustCardData> = {}): TrustCardData {
  return {
    entityId: "e1",
    name: "Tom's SLAT",
    subType: "slat",
    isIrrevocable: true,
    grantorRole: "client",
    trusteeName: "Sarah Smith",
    rows: [baseRow],
    total: 2_400_000,
    exemptionConsumed: 2_400_000,
    exemptionAvailable: 15_000_000,
    breach: false,
    ...overrides,
  };
}

const data: TrustCardData = makeTrustCardData();

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

  it("renders breach glyph when data.breach is true", () => {
    render(<TrustCard data={makeTrustCardData({ breach: true })} />);
    expect(screen.getByLabelText(/exceeds lifetime exemption/i)).toBeInTheDocument();
  });

  it("does not render breach glyph when data.breach is false", () => {
    render(<TrustCard data={makeTrustCardData({ breach: false })} />);
    expect(screen.queryByLabelText(/exceeds lifetime exemption/i)).not.toBeInTheDocument();
  });

  it("renders split-interest details panel when splitInterest is populated", () => {
    const trust = makeTrustCardData({
      subType: "clut",
      splitInterest: {
        inceptionYear: 2026,
        inceptionValue: 1_000_000,
        payoutType: "unitrust",
        payoutPercent: 0.06,
        irc7520Rate: 0.022,
        termType: "years",
        termYears: 10,
        charityName: "Acme Foundation",
        originalIncomeInterest: 461_385,
        originalRemainderInterest: 538_615,
      },
    });
    render(<TrustCard data={trust} defaultExpanded />);
    expect(screen.getByText(/split-interest details/i)).toBeInTheDocument();
    expect(screen.getByText("6.00% unitrust")).toBeInTheDocument();
    expect(screen.getByText("2.20%")).toBeInTheDocument();
    expect(screen.getByText(/10 years/)).toBeInTheDocument();
    expect(screen.getByText("Acme Foundation")).toBeInTheDocument();
    expect(screen.getByText("$461,385")).toBeInTheDocument();
    expect(screen.getByText("$538,615")).toBeInTheDocument();
  });

  it("omits split-interest panel when splitInterest is undefined", () => {
    render(<TrustCard data={data} defaultExpanded />);
    expect(screen.queryByText(/split-interest details/i)).not.toBeInTheDocument();
  });
});
