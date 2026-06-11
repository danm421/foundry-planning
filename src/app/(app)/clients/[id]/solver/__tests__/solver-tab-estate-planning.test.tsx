// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Account } from "@/engine/types";
import { SolverSideContext } from "../solver-section";
import { EstateRevocableTrustList } from "../solver-tab-estate-planning";

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
