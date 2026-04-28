// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ClientCard } from "../client-card";
import type { ClientCardData } from "../../lib/derive-card-data";

// DnD and context hooks are stubbed via vi.mock in setup — but client-card
// uses useDraggable. We mock @dnd-kit/core so the JSDOM environment can render.
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    isDragging: false,
  }),
}));

// ClientCard calls useAllocateRequest from the DnD provider context.
vi.mock("../../dnd-context-provider", () => ({
  useAllocateRequest: () => ({ onAllocateRequest: () => undefined }),
}));

const data: ClientCardData = {
  ownerKey: "client",
  familyMemberId: "fm-tom",
  name: "Tom",
  ageDescriptor: "Age 64",
  rows: [
    {
      accountId: "a1",
      accountName: "Brokerage",
      category: "taxable",
      taxTag: "TAX",
      ownerPercent: 0.6,
      sliceValue: 1_200_000,
      hasMultipleOwners: true,
      coOwners: [{ label: "Linda", percent: 0.3 }, { label: "SLAT", percent: 0.1 }],
    },
    {
      accountId: "a2",
      accountName: "Solo IRA",
      category: "retirement",
      taxTag: "DEF",
      ownerPercent: 1,
      sliceValue: 500_000,
      hasMultipleOwners: false,
      coOwners: [],
    },
  ],
  total: 1_700_000,
};

const dataWithOwnerKey: ClientCardData = { ...data, name: "Tom Smith", ageDescriptor: "Age 58 · Grantor of 2 trusts" };

describe("ClientCard", () => {
  it("renders collapsed by default with name and age descriptor", () => {
    render(<ClientCard data={dataWithOwnerKey} />);
    expect(screen.getByText("Tom Smith")).toBeInTheDocument();
    expect(screen.getByText("Age 58 · Grantor of 2 trusts")).toBeInTheDocument();
    expect(screen.queryByText("Brokerage")).not.toBeInTheDocument();
  });

  it("expands when the card row is clicked", () => {
    render(<ClientCard data={dataWithOwnerKey} />);
    fireEvent.click(screen.getByRole("button", { name: /Tom Smith/i }));
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Solo IRA")).toBeInTheDocument();
  });

  it("renders one row per slice in the rows array", () => {
    render(<ClientCard data={data} defaultExpanded />);
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Solo IRA")).toBeInTheDocument();
  });

  it("shows the slice indicator pill on fractional rows", () => {
    render(<ClientCard data={data} defaultExpanded />);
    // Brokerage is 60% owned by Tom — expect a pill with "Tom 60%"
    expect(screen.getByText(/Tom 60%/)).toBeInTheDocument();
  });

  it("shows the breakdown sub-line only when account has multiple owners", () => {
    render(<ClientCard data={data} defaultExpanded />);
    // Brokerage has coOwners: Linda 30%, SLAT 10%
    expect(screen.getByText(/Linda 30%/)).toBeInTheDocument();
    expect(screen.getByText(/SLAT 10%/)).toBeInTheDocument();
    // Solo IRA is sole-owned — no sub-line breakdown
    const soloIraRow = screen.getByText("Solo IRA").closest("[data-row]");
    expect(soloIraRow?.querySelector("[data-sub-line]")).toBeNull();
  });

  it("renders the tax-treatment tag for each row", () => {
    render(<ClientCard data={data} defaultExpanded />);
    expect(screen.getByText("TAX")).toBeInTheDocument();
    expect(screen.getByText("DEF")).toBeInTheDocument();
  });
});
