// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Account } from "@/engine/types";
import {
  EstateRevocableTrustList,
  EstateGiftsList,
} from "../solver-tab-estate-planning";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const acct = (over: Partial<Account>): Account =>
  ({
    id: "a", name: "Acct", category: "taxable", subType: "brokerage",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "individual", owners: [],
    ...over,
  } as unknown as Account);

function renderRev(over = {}) {
  const props = {
    enabled: false,
    trustName: "Revocable Living Trust",
    eligible: [acct({ id: "e1", name: "Brokerage" })],
    taggedIds: new Set<string>(),
    onToggleEnabled: vi.fn(),
    onChangeName: vi.fn(),
    onToggleAccount: vi.fn(),
    onSelectAll: vi.fn(),
    ...over,
  };
  render(<EstateRevocableTrustList {...props} />);
}

describe("EstateRevocableTrustList", () => {
  it("renders the create toggle", () => {
    renderRev();
    expect(screen.getByText("Create a revocable living trust")).toBeTruthy();
  });

  it("collapses the probate-account list by default, showing a selected count", () => {
    renderRev({
      enabled: true,
      eligible: [acct({ id: "e1", name: "Brokerage" }), acct({ id: "e2", name: "Savings" })],
      taggedIds: new Set(["e1"]),
    });
    expect(screen.getByText(/1 of 2 selected/)).toBeTruthy();
    expect(screen.queryByText("Brokerage")).toBeNull();
  });

  it("reveals the account checkboxes when the header is clicked", () => {
    renderRev({
      enabled: true,
      eligible: [acct({ id: "e1", name: "Brokerage" }), acct({ id: "e2", name: "Savings" })],
      taggedIds: new Set(["e1"]),
    });
    fireEvent.click(screen.getByRole("button", { name: /move probate/i }));
    expect(screen.getByText("Brokerage")).toBeTruthy();
    expect(screen.getByText("Savings")).toBeTruthy();
  });
});

const baseGift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2029, amount: 10000, grantor: "client",
  recipient: { kind: "family_member", id: "f0" }, crummey: false,
};
const draftGift: EstateFlowGift = {
  kind: "cash-once", id: "d1", year: 2030, amount: 25000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function renderGifts(over: {
  gifts?: EstateFlowGift[];
  baseGiftIds?: Set<string>;
  onToggle?: (g: EstateFlowGift) => void;
  onEdit?: (g: EstateFlowGift) => void;
  onRemove?: (id: string) => void;
} = {}) {
  render(
    <EstateGiftsList
      gifts={[baseGift, draftGift]}
      baseGiftIds={new Set(["g1"])}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
      {...over}
    />,
  );
}

describe("EstateGiftsList", () => {
  it("shows gifts with badges and remove controls", () => {
    renderGifts();
    expect(screen.getByText("Base plan")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getAllByText("Remove")).toHaveLength(2);
  });

  it("shows an empty state when there are no gifts at all", () => {
    renderGifts({ gifts: [], baseGiftIds: new Set() });
    expect(screen.getByText("No planned gifts")).toBeTruthy();
  });
});
