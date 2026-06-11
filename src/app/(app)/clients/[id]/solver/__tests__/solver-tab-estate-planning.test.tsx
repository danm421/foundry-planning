// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Account } from "@/engine/types";
import { SolverSideContext } from "../solver-section";
import { EstateRevocableTrustList } from "../solver-tab-estate-planning";
import { EstateGiftsList } from "../solver-tab-estate-planning";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const acct = (over: Partial<Account>): Account =>
  ({
    id: "a", name: "Acct", category: "taxable", subType: "brokerage",
    value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "individual", owners: [],
    ...over,
  } as unknown as Account);

function renderRev(side: "base" | "working", over = {}) {
  const props = {
    current: [],
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
  render(
    <SolverSideContext.Provider value={side}>
      <EstateRevocableTrustList {...props} />
    </SolverSideContext.Provider>,
  );
}

describe("EstateRevocableTrustList", () => {
  it("base side lists existing revocable trusts read-only (no checkbox)", () => {
    renderRev("base", { current: [{ name: "Smith RLT", accountNames: ["Brokerage", "Cash"] }] });
    expect(screen.getByText("Smith RLT")).toBeTruthy();
    expect(screen.queryByText("Create a revocable living trust")).toBeNull();
  });

  it("base side shows an empty state when none exist", () => {
    renderRev("base");
    expect(screen.getByText("No revocable living trust")).toBeTruthy();
  });

  it("working side renders the create toggle", () => {
    renderRev("working");
    expect(screen.getByText("Create a revocable living trust")).toBeTruthy();
  });
});

const draftGift: EstateFlowGift = {
  kind: "cash-once", id: "d1", year: 2030, amount: 25000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function renderGifts(side: "base" | "working", over = {}) {
  render(
    <SolverSideContext.Provider value={side}>
      <EstateGiftsList
        currentGifts={[{ id: "g1", label: "Cash gift 2029: $10,000 → Jane Doe" }]}
        draftGifts={[draftGift]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        {...over}
      />
    </SolverSideContext.Provider>,
  );
}

describe("EstateGiftsList", () => {
  it("base side shows current gifts read-only and no draft Remove control", () => {
    renderGifts("base");
    expect(screen.getByText("Cash gift 2029: $10,000 → Jane Doe")).toBeTruthy();
    expect(screen.queryByText("Remove")).toBeNull();
  });

  it("working side shows current gifts plus removable drafts", () => {
    renderGifts("working");
    expect(screen.getByText("Cash gift 2029: $10,000 → Jane Doe")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("shows an empty state when there are no gifts at all", () => {
    renderGifts("base", { currentGifts: [], draftGifts: [] });
    expect(screen.getByText("No planned gifts")).toBeTruthy();
  });
});
