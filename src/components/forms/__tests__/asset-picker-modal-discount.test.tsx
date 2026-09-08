// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AssetPickerModal from "../asset-picker-modal";
import type { PickerAccount, PickerBusiness } from "../asset-picker-modal";

const TRUST_ID = "trust-abc";

const businesses: PickerBusiness[] = [
  {
    id: "biz-1",
    name: "Acme Family LLC",
    value: 1_000_000,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
  },
];

const accountsList: PickerAccount[] = [
  {
    id: "acct-1",
    name: "Joint Brokerage",
    subType: "brokerage",
    isDefaultChecking: false,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
  },
];

function open(over: Partial<React.ComponentProps<typeof AssetPickerModal>> = {}) {
  const onAdd = vi.fn();
  render(
    <AssetPickerModal
      entityId={TRUST_ID}
      accounts={[]}
      liabilities={[]}
      businesses={businesses}
      // The discount field is only offered for an irrevocable recipient, since
      // only that transfer is a completed gift. These cases are all about the
      // field itself, so they declare it; the gate has its own cases below.
      entityIsIrrevocable
      onClose={vi.fn()}
      onAdd={onAdd}
      {...over}
    />,
  );
  return onAdd;
}

describe("AssetPickerModal — valuation discount on the business branch", () => {
  it("shows the discount field after picking a business", () => {
    open();
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    expect(screen.getByText("Set Ownership Percent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Valuation discount/i)).toBeInTheDocument();
  });

  it("does NOT show the discount field for an account", () => {
    open({ accounts: accountsList, businesses: [] });
    fireEvent.click(screen.getByLabelText("Select Joint Brokerage"));
    expect(screen.getByText("Set Ownership Percent")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
  });

  it("previews the full and discounted transfer values", () => {
    open();
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    fireEvent.change(screen.getByLabelText("Ownership percent"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "35" } });
    const preview = screen.getByTestId("picker-discount-preview").textContent ?? "";
    // 1,000,000 × 30% = 300,000 full → 195,000 after a 35% discount.
    // Asserted exactly, not by substring: "0.35%" contains "35%" and
    // "$300,000,000" contains "$300,000", so a toContain here would survive the
    // fraction-vs-percent and ×100 scale errors this whole surface exists to
    // prevent.
    expect(preview.replace(/\s+/g, " ").trim()).toBe(
      "$300,000 interest · 35% discount · $195,000 uses exemption",
    );
  });

  it("passes the discount to onAdd as a fraction alongside the whole-number percent", () => {
    const onAdd = open();
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    fireEvent.change(screen.getByLabelText("Ownership percent"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({
      type: "add",
      assetType: "entity",
      assetId: "biz-1",
      percent: 30,
      valuationDiscount: 0.35,
    });
  });

  it("omits valuationDiscount when the field is left blank", () => {
    const onAdd = open();
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({
      type: "add",
      assetType: "entity",
      assetId: "biz-1",
      percent: 100,
    });
  });

  it("prefills from priorDiscounts for the picked business", () => {
    open({ priorDiscounts: { "entity:biz-1": 0.25 } });
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    expect((screen.getByLabelText(/Valuation discount/i) as HTMLInputElement).value).toBe("25");
  });

  // ── The field never shows a number it will not save ────────────────────────
  // Both cases below are the same defect from two directions: a discount above
  // MAX_DISCOUNT_PCT sitting in the box while `onAdd` quietly drops it.

  it("clamps a typed discount to the shared maximum, and saves what it shows", () => {
    const onAdd = open();
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "150" } });
    expect((screen.getByLabelText(/Valuation discount/i) as HTMLInputElement).value).toBe("99");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({
      type: "add",
      assetType: "entity",
      assetId: "biz-1",
      percent: 100,
      valuationDiscount: 0.99,
    });
  });

  it("clamps a prior discount stored above the maximum when it seeds the field", () => {
    // 0.995 is legal in the column but higher than any form will display.
    const onAdd = open({ priorDiscounts: { "entity:biz-1": 0.995 } });
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    expect((screen.getByLabelText(/Valuation discount/i) as HTMLInputElement).value).toBe("99");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({
      type: "add",
      assetType: "entity",
      assetId: "biz-1",
      percent: 100,
      valuationDiscount: 0.99,
    });
  });
});

// ── The field is only offered where the transfer is a completed gift ─────────
// The route writes a §709 gift row only when the receiving trust is
// irrevocable. Offering the field on a revocable trust would show a real
// "uses exemption" figure for a discount the route then silently discards.

describe("AssetPickerModal — the discount field follows the recipient's irrevocability", () => {
  it("does NOT offer a discount on a REVOCABLE trust", () => {
    open({ entityIsIrrevocable: false });
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    // The percent step is still reached — only the discount block is gone.
    expect(screen.getByText("Set Ownership Percent")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
  });

  it("DOES offer a discount on an irrevocable trust", () => {
    open({ entityIsIrrevocable: true });
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    expect(screen.getByLabelText(/Valuation discount/i)).toBeInTheDocument();
  });

  it("hides the field by default, so a caller cannot promise exemption savings by omission", () => {
    render(
      <AssetPickerModal
        entityId={TRUST_ID}
        accounts={[]}
        liabilities={[]}
        businesses={businesses}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
  });

  it("emits no valuationDiscount on a revocable trust even if one was seeded", () => {
    // priorDiscounts seeds `discountStr` inside selectItem regardless of the
    // gate, so this pins that the hidden value cannot ride out on the op.
    const onAdd = open({
      entityIsIrrevocable: false,
      priorDiscounts: { "entity:biz-1": 0.25 },
    });
    fireEvent.click(screen.getByLabelText("Select Acme Family LLC"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith({
      type: "add",
      assetType: "entity",
      assetId: "biz-1",
      percent: 100,
    });
  });
});
