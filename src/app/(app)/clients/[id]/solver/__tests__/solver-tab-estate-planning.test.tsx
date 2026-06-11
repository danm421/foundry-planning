// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Account, EntitySummary } from "@/engine/types";
import { SolverSideContext } from "../solver-section";
import { EstateRevocableTrustList } from "../solver-tab-estate-planning";
import { EstateGiftsList } from "../solver-tab-estate-planning";
import { EstateTrustsList } from "../solver-tab-estate-planning";
import { EstateCharitiesList } from "../solver-tab-estate-planning";
import type { SolverTrustDraft } from "../solver-trust-form";
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

const currentTrust = { id: "t1", name: "Existing ILIT", entityType: "trust", trustSubType: "ilit" } as unknown as EntitySummary;
const addedTrust = {
  entity: { id: "t2", name: "New CRT", trustSubType: "crt" },
  fundedOriginals: [],
} as unknown as SolverTrustDraft;

function renderTrusts(side: "base" | "working", over = {}) {
  render(
    <SolverSideContext.Provider value={side}>
      <EstateTrustsList currentTrusts={[currentTrust]} addedTrusts={[addedTrust]} onRemove={vi.fn()} {...over} />
    </SolverSideContext.Provider>,
  );
}

describe("EstateTrustsList", () => {
  it("base side lists existing trusts read-only", () => {
    renderTrusts("base");
    expect(screen.getByText("Existing ILIT")).toBeTruthy();
    expect(screen.queryByText("New CRT")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
  });

  it("working side lists existing + added trusts, only the added one removable", () => {
    renderTrusts("working");
    expect(screen.getByText("Existing ILIT")).toBeTruthy();
    expect(screen.getByText(/New CRT/)).toBeTruthy();
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  it("shows an empty state when there are no trusts", () => {
    renderTrusts("base", { currentTrusts: [], addedTrusts: [] });
    expect(screen.getByText("No trusts")).toBeTruthy();
  });
});

function renderCharities(side: "base" | "working", over = {}) {
  render(
    <SolverSideContext.Provider value={side}>
      <EstateCharitiesList
        currentCharities={[{ id: "c1", name: "Red Cross", charityType: "public" }]}
        addedCharities={[{ id: "c2", name: "New Foundation", charityType: "private" }]}
        charityName=""
        charityType="public"
        onChangeName={vi.fn()}
        onChangeType={vi.fn()}
        onAdd={vi.fn()}
        {...over}
      />
    </SolverSideContext.Provider>,
  );
}

describe("EstateCharitiesList", () => {
  it("base side lists current charities read-only with no add form", () => {
    renderCharities("base");
    expect(screen.getByText("Red Cross")).toBeTruthy();
    expect(screen.queryByText("New Foundation")).toBeNull();
    expect(screen.queryByPlaceholderText("Charity name")).toBeNull();
  });

  it("working side lists current + added charities and shows the add form", () => {
    renderCharities("working");
    expect(screen.getByText("Red Cross")).toBeTruthy();
    expect(screen.getByText("New Foundation")).toBeTruthy();
    expect(screen.getByPlaceholderText("Charity name")).toBeTruthy();
  });
});
