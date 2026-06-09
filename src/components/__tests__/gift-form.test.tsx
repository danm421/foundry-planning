// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftForm, { type GiftFormProps } from "@/components/gift-form";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const base = (over: Partial<GiftFormProps> = {}): GiftFormProps => ({
  recipients: {
    trusts: [{ id: "t1", name: "ILIT" }],
    familyMembers: [{ id: "m1", firstName: "Jane", lastName: "Doe", roleLabel: "child" }],
    externals: [{ id: "x1", name: "Red Cross", kindLabel: "charity" }],
  },
  accounts: [{ id: "a1", name: "Brokerage" }],
  hasSpouse: true,
  annualExclusionByYear: { 2026: 19_000 },
  editing: null,
  onChange: vi.fn(),
  ...over,
});

function lastDraft(onChange: ReturnType<typeof vi.fn>): EstateFlowGift | null {
  const calls = onChange.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("GiftForm", () => {
  it("emits a cash-once draft for a family recipient", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    // amount defaults to 0 → still need a positive amount
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "1000" } });
    const d = lastDraft(onChange);
    expect(d).toMatchObject({ kind: "cash-once", amount: 1000, recipient: { kind: "family_member", id: "m1" } });
  });

  it("computes the max-exclusion amount (×2 for joint) for a recurring trust gift", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.change(screen.getByTestId("grantor"), { target: { value: "joint" } });
    fireEvent.click(screen.getByText("Max annual exclusion"));
    const d = lastDraft(onChange);
    expect(d).toMatchObject({ kind: "series", amountMode: "annual_exclusion", annualAmount: 38_000, grantor: "joint" });
    expect(Object.keys(d as object)).toEqual([
      "kind", "id", "startYear", "endYear", "annualAmount",
      "amountMode", "inflationAdjust", "grantor", "recipient", "crummey",
    ]);
  });

  it("restricts recipients to trusts when recurring", () => {
    render(<GiftForm {...base()} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Recurring"));
    const values = [...(screen.getByTestId("recipient") as HTMLSelectElement).options].map((o) => o.value);
    expect(values).toContain("entity:t1");
    expect(values).not.toContain("family_member:m1");
  });

  it("round-trips an existing series draft without spurious change (diff stability)", () => {
    const editing: EstateFlowGift = {
      kind: "series", id: "se1", startYear: 2026, endYear: 2026, annualAmount: 5_000,
      amountMode: "fixed", inflationAdjust: false, grantor: "client",
      recipient: { kind: "entity", id: "t1" }, crummey: false,
    };
    const onChange = vi.fn();
    render(<GiftForm {...base({ editing, onChange })} ledger={[{ year: 2026 } as never]} />);
    const d = lastDraft(onChange);
    expect(JSON.stringify(d)).toEqual(JSON.stringify(editing));
  });
});
