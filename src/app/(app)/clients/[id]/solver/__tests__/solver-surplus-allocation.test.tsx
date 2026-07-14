// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import { SolverSurplusAllocation } from "../solver-surplus-allocation";

function tree(overrides: Partial<ClientData["planSettings"]> = {}, accounts: unknown[] = []): ClientData {
  return {
    accounts,
    planSettings: { surplusSpendPct: 0.3, surplusSaveAccountId: "acct-1", ...overrides },
  } as unknown as ClientData;
}

const HOUSEHOLD = [
  { id: "acct-1", name: "Checking", category: "cash", subType: "checking", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners: [{ kind: "family_member", familyMemberId: "fm", percent: 1 }] },
  { id: "acct-2", name: "Brokerage", category: "taxable", subType: "brokerage", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners: [{ kind: "family_member", familyMemberId: "fm", percent: 1 }] },
];

function renderControl(working: ClientData, base: ClientData, onChange = vi.fn(), onResetField = vi.fn()) {
  render(
    <SolverSurplusAllocation
      workingTree={working}
      baseClientData={base}
      onChange={onChange}
      onResetField={onResetField}
    />,
  );
  return { onChange, onResetField };
}

describe("SolverSurplusAllocation", () => {
  it("changing the save-to account emits a combined mutation", () => {
    const t = tree({}, HOUSEHOLD);
    const { onChange } = renderControl(t, t);
    fireEvent.change(screen.getByLabelText("Save remainder to"), { target: { value: "acct-2" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "surplus-allocation",
      spendPct: 0.3,
      saveAccountId: "acct-2",
    });
  });

  it("selecting household checking emits a null account", () => {
    const t = tree({}, HOUSEHOLD);
    const { onChange } = renderControl(t, t);
    fireEvent.change(screen.getByLabelText("Save remainder to"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "surplus-allocation",
      spendPct: 0.3,
      saveAccountId: null,
    });
  });

  it("editing the spend % emits spendPct as a decimal", () => {
    const t = tree({}, HOUSEHOLD);
    const { onChange } = renderControl(t, t);
    fireEvent.click(screen.getByLabelText("Edit Spend % of surplus"));
    // SolverFieldSlider's Radix Slider.Thumb also carries aria-label={label}
    // (always rendered, even while editing), so getByLabelText is ambiguous
    // between the thumb (role="slider") and the edit input — scope by role.
    const input = screen.getByRole("textbox", { name: "Spend % of surplus" });
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({
      kind: "surplus-allocation",
      spendPct: 0.4,
      saveAccountId: "acct-1",
    });
  });

  it("hides Reset to base when working equals base", () => {
    const t = tree({}, HOUSEHOLD);
    renderControl(t, t);
    expect(screen.queryByText("Reset to base")).toBeNull();
  });

  it("shows Reset to base when changed and clears the lever on click", () => {
    const working = tree({ surplusSpendPct: 0.6 }, HOUSEHOLD);
    const base = tree({ surplusSpendPct: 0.3 }, HOUSEHOLD);
    const { onResetField } = renderControl(working, base);
    fireEvent.click(screen.getByText("Reset to base"));
    expect(onResetField).toHaveBeenCalledWith(["surplus-allocation"]);
  });

  it("excludes entity-owned accounts from the destination list", () => {
    const trustAccount = { ...HOUSEHOLD[1], id: "acct-trust", name: "Trust Brokerage", owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] };
    const t = tree({}, [...HOUSEHOLD, trustAccount]);
    renderControl(t, t);
    expect(screen.queryByRole("option", { name: "Trust Brokerage" })).toBeNull();
  });
});
