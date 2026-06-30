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

  it("all recipients remain selectable when recurring (trust gate lifted)", () => {
    render(<GiftForm {...base()} />);
    // Switch to recurring mode (trust pre-selected so the toggle is enabled initially)
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Recurring"));
    const values = [...(screen.getByTestId("recipient") as HTMLSelectElement).options].map((o) => o.value);
    expect(values).toContain("entity:t1");
    // Family members and externals must also remain in the list
    expect(values).toContain("family_member:m1");
    expect(values).toContain("external_beneficiary:x1");
  });

  it("recurring + specific-asset controls are available for a family member; Crummey is absent", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    // Select a family member (non-trust)
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });

    // (a) Recurring segment should NOT be disabled
    const recurringOption = screen.getByText("Recurring");
    expect(recurringOption.closest("button")).not.toBeDisabled();

    // (b) "Specific asset" funding segment should be present (accounts list is non-empty)
    expect(screen.getByText("Specific asset")).toBeInTheDocument();

    // (c) Crummey checkbox is absent for a non-trust recipient
    expect(screen.queryByText(/crummey/i)).not.toBeInTheDocument();
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

  it("emits an asset-once draft via the accounts picker when no sourceAccount (details in-kind path)", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "a1" } });
    const d = lastDraft(onChange);
    expect(d).toMatchObject({ kind: "asset-once", accountId: "a1", percent: 1, recipient: { kind: "entity", id: "t1" } });
  });

  it("series draft has crummey:false when recipient is switched from trust to family member", () => {
    // Regression: series branch emitted bare `crummey` state without the recipientIsTrust guard.
    // Start editing an existing trust series with crummey:true, then switch recipient to family member.
    const editing: EstateFlowGift = {
      kind: "series", id: "se2", startYear: 2026, endYear: 2026, annualAmount: 5_000,
      amountMode: "fixed", inflationAdjust: false, grantor: "client",
      recipient: { kind: "entity", id: "t1" }, crummey: true,
    };
    const onChange = vi.fn();
    render(<GiftForm {...base({ editing, onChange })} />);
    // Switch recipient to family member (non-trust) — Crummey checkbox disappears but state stays true.
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    const d = lastDraft(onChange);
    expect(d?.kind).toBe("series");
    // Without the recipientIsTrust guard this would be `true`, proving falsifiability.
    expect((d as Extract<EstateFlowGift, { kind: "series" }>).crummey).toBe(false);
  });

  it("round-trips an existing asset-once gift with no sourceAccount", () => {
    const editing: EstateFlowGift = {
      kind: "asset-once", id: "as1", year: 2026, accountId: "a1", percent: 0.5,
      grantor: "client", recipient: { kind: "entity", id: "t1" },
    };
    const onChange = vi.fn();
    render(<GiftForm {...base({ editing, onChange })} />);
    const d = lastDraft(onChange);
    expect(d).toMatchObject({ kind: "asset-once", accountId: "a1", percent: 0.5, recipient: { kind: "entity", id: "t1" } });
  });
});
