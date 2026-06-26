// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Account, EntitySummary } from "@/engine/types";
import {
  EstateRevocableTrustList,
  EstateGiftsList,
  EstateTrustsList,
  EstateCharitiesList,
} from "../solver-tab-estate-planning";
import type { SolverTrustDraft } from "../solver-trust-form";
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
});

const draftGift: EstateFlowGift = {
  kind: "cash-once", id: "d1", year: 2030, amount: 25000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function renderGifts(over = {}) {
  render(
    <EstateGiftsList
      currentGifts={[{ id: "g1", label: "Cash gift 2029: $10,000 → Jane Doe" }]}
      draftGifts={[draftGift]}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
      {...over}
    />,
  );
}

describe("EstateGiftsList", () => {
  it("shows current gifts plus removable drafts", () => {
    renderGifts();
    expect(screen.getByText("Cash gift 2029: $10,000 → Jane Doe")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("shows an empty state when there are no gifts at all", () => {
    renderGifts({ currentGifts: [], draftGifts: [] });
    expect(screen.getByText("No planned gifts")).toBeTruthy();
  });
});

const currentTrust = { id: "t1", name: "Existing ILIT", entityType: "trust", trustSubType: "ilit" } as unknown as EntitySummary;
const addedTrust = {
  entity: { id: "t2", name: "New CRT", trustSubType: "crt" },
  fundedOriginals: [],
} as unknown as SolverTrustDraft;

function renderTrusts(over = {}) {
  render(
    <EstateTrustsList currentTrusts={[currentTrust]} addedTrusts={[addedTrust]} onRemove={vi.fn()} {...over} />,
  );
}

describe("EstateTrustsList", () => {
  it("lists existing + added trusts, only the added one removable", () => {
    renderTrusts();
    expect(screen.getByText("Existing ILIT")).toBeTruthy();
    expect(screen.getByText(/New CRT/)).toBeTruthy();
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  it("shows an empty state when there are no trusts", () => {
    renderTrusts({ currentTrusts: [], addedTrusts: [] });
    expect(screen.getByText("No trusts")).toBeTruthy();
  });
});

function renderCharities(over = {}) {
  render(
    <EstateCharitiesList
      currentCharities={[{ id: "c1", name: "Red Cross", charityType: "public" }]}
      addedCharities={[{ id: "c2", name: "New Foundation", charityType: "private" }]}
      charityName=""
      charityType="public"
      onChangeName={vi.fn()}
      onChangeType={vi.fn()}
      onAdd={vi.fn()}
      {...over}
    />,
  );
}

describe("EstateCharitiesList", () => {
  it("lists current + added charities and shows the add form", () => {
    renderCharities();
    expect(screen.getByText("Red Cross")).toBeTruthy();
    expect(screen.getByText("New Foundation")).toBeTruthy();
    expect(screen.getByPlaceholderText("Charity name")).toBeTruthy();
  });
});
