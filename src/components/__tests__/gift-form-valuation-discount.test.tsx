// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftForm, { type GiftFormProps } from "@/components/gift-form";
import { diffGifts } from "@/lib/estate/estate-flow-gift-diff";
import { giftRowToDraft } from "@/lib/estate/estate-flow-gifts";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import { beaForYear } from "@/lib/tax/estate";

const recipients = {
  trusts: [{ id: "t1", name: "Dynasty Trust" }],
  familyMembers: [{ id: "k1", firstName: "Alice", lastName: "Byron", roleLabel: "child" }],
  externals: [],
};

const accounts = [
  { id: "acct-1", name: "Family LLC Units", value: 1_000_000, subType: "other" },
  { id: "acct-2", name: "Joint Brokerage", value: 500_000, subType: "brokerage" },
];

function renderForm(over: Partial<GiftFormProps> = {}) {
  const onChange = vi.fn();
  render(
    <GiftForm
      recipients={recipients}
      accounts={accounts}
      hasSpouse={false}
      annualExclusionByYear={{ 2030: 19_000 }}
      editing={null}
      onChange={onChange}
      {...over}
    />,
  );
  return onChange;
}

function lastDraft(onChange: ReturnType<typeof vi.fn>): EstateFlowGift | null {
  return onChange.mock.calls.at(-1)?.[0] ?? null;
}

/**
 * A one-year ledger whose client has ALREADY used the whole lifetime exemption,
 * so any taxable gift breaches by exactly its own value. That makes the
 * exemption overage a direct readout of `taxableContribution`.
 */
function exhaustedLedger(year: number): GiftLedgerYear[] {
  return [
    {
      year,
      giftsGiven: 0,
      taxableGiftsGiven: 0,
      perGrantor: {
        client: {
          taxableGiftsThisYear: 0,
          // taxInflationRate defaults to 0, so this is the BEA the warning uses.
          cumulativeTaxableGifts: beaForYear(year, 0),
          creditUsed: 0,
          giftTaxThisYear: 0,
          cumulativeGiftTax: 0,
        },
      },
      totalGiftTax: 0,
    },
  ];
}

/** The breach alert's sentence, isolated from the discount preview above it
 *  (both mention dollar figures). */
function breachText(): string {
  return screen.getByText(/remaining\s+lifetime\s+exemption\s+by/i).textContent ?? "";
}

/** Drive the form to "30% discount on 100% of the Family LLC units". */
function selectDiscountedAssetGift(accountId = "acct-1") {
  fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
  fireEvent.click(screen.getByText("Specific asset"));
  fireEvent.change(screen.getByTestId("account"), { target: { value: accountId } });
  fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });
}

describe("GiftForm — valuation discount", () => {
  it("hides the discount field for a cash gift to a family member", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:k1" } });
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
  });

  it("shows the discount field for a cash gift to a trust", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    expect(screen.getByLabelText(/Valuation discount/i)).toBeTruthy();
  });

  it("puts the discount on the draft as a fraction and shows the live preview", () => {
    const onChange = renderForm();
    selectDiscountedAssetGift();

    const draft = lastDraft(onChange)!;
    expect(draft.kind).toBe("asset-once");
    expect(draft.valuationDiscount).toBeCloseTo(0.3, 6);
    // The invariant: a discount is a transfer-tax concept only. It must never
    // reach the ownership percentage — the recipient still gets 100% of the
    // units, they are merely valued at $700k for §2512.
    expect((draft as Extract<EstateFlowGift, { kind: "asset-once" }>).percent).toBe(1);

    const preview = screen.getByTestId("discount-preview").textContent ?? "";
    expect(preview).toContain("$1,000,000");
    expect(preview).toContain("30%");
    expect(preview).toContain("$700,000");
  });

  it("emits no discount at all when the field is left at zero", () => {
    // Guards the phantom-diff contract: "no discount" must be an absent key,
    // not a 0, so an untouched gift still JSON.stringify-matches its DB draft.
    const onChange = renderForm();
    selectDiscountedAssetGift();
    expect(lastDraft(onChange)!.valuationDiscount).toBeCloseTo(0.3, 6);

    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "0" } });
    expect(lastDraft(onChange)!.valuationDiscount).toBeUndefined();
    expect(screen.queryByTestId("discount-preview")).toBeNull();
  });

  it("warns on a marketable brokerage source but not on an LLC-unit source", () => {
    renderForm();
    selectDiscountedAssetGift("acct-1");
    expect(screen.queryByTestId("discount-appraisal-warning")).toBeNull();

    fireEvent.change(screen.getByTestId("account"), { target: { value: "acct-2" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });
    expect(screen.getByTestId("discount-appraisal-warning")).toBeTruthy();
  });

  it("prefills from priorDiscounts for the selected account, and stops once edited", () => {
    const onChange = renderForm({ priorDiscounts: { "acct-1": 0.35 } });
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "acct-1" } });
    expect(lastDraft(onChange)!.valuationDiscount).toBeCloseTo(0.35, 6);

    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("account"), { target: { value: "acct-2" } });
    // Prefill must not overwrite an advisor-entered value.
    expect(lastDraft(onChange)!.valuationDiscount).toBeCloseTo(0.1, 6);
  });

  it("never prefills over an existing gift that was saved without a discount", () => {
    // The source gift on acct-1 carries 35%, but THIS gift was deliberately
    // saved undiscounted. Seeding it would silently move a filed 709 figure
    // and post a phantom "Edited gift".
    const existing = giftRowToDraft({
      id: "g-plain", year: 2030, amount: null, grantor: "client",
      recipientEntityId: "t1", recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null, accountId: "acct-1", liabilityId: null,
      businessEntityId: null, percent: "0.2500", useCrummeyPowers: false,
      eventKind: "outright", valuationDiscount: null,
    })!;
    const onChange = renderForm({ editing: existing, priorDiscounts: { "acct-1": 0.35 } });

    expect(lastDraft(onChange)!.valuationDiscount).toBeUndefined();
    expect(diffGifts([existing], [lastDraft(onChange)!])).toEqual([]);
  });

  it("produces NO phantom diff when an existing discounted gift is opened unchanged", () => {
    const existing = giftRowToDraft({
      id: "g-existing", year: 2030, amount: null, grantor: "client",
      recipientEntityId: "t1", recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null, accountId: "acct-1", liabilityId: null,
      businessEntityId: null, percent: "0.2500", useCrummeyPowers: false,
      eventKind: "outright", valuationDiscount: "0.3000",
    })!;
    const onChange = renderForm({ editing: existing });
    const draft = lastDraft(onChange)!;
    expect(diffGifts([existing], [draft])).toEqual([]);
  });
  it("clamps an out-of-range entry so the field and the saved value agree", () => {
    // NumberInput passes Number(e.target.value) straight through; min/max are
    // HTML hints only. Unclamped, "150" would read as 150 while storing NO
    // discount — and on an edit would clear one already saved.
    const onChange = renderForm();
    selectDiscountedAssetGift();

    const input = screen.getByLabelText(/Valuation discount/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "150" } });

    expect(input.value).toBe("99");
    expect(lastDraft(onChange)!.valuationDiscount).toBeCloseTo(0.99, 6);
    expect(screen.getByTestId("discount-preview").textContent).toContain("99%");

    fireEvent.change(input, { target: { value: "-20" } });
    expect(input.value).toBe("0");
    expect(lastDraft(onChange)!.valuationDiscount).toBeUndefined();
  });

  it("hides the whole block when the caller opts out", () => {
    // The Family view's GiftDialog cannot supply account values or round-trip a
    // saved discount, so it must not render a field that would read a flat 0%.
    const onChange = renderForm({ showValuationDiscount: false });
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "50000" } });

    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
    expect(screen.queryByTestId("discount-preview")).toBeNull();
    expect(lastDraft(onChange)!.valuationDiscount).toBeUndefined();
  });

  it("charges the DISCOUNTED value against the lifetime exemption preview", () => {
    // The exemption is already exhausted, so the overage IS the taxable value.
    // A $1,000,000 interest at a 30% discount must breach by $700,000.
    renderForm({
      ledger: exhaustedLedger(2030),
      annualExclusionByYear: { 2030: 19_000 },
      sourceAccount: { id: "acct-1", name: "Family LLC Units", value: 1_000_000, subType: "other" },
    });
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });

    expect(breachText()).toContain("$700,000");
    expect(breachText()).not.toContain("$1,000,000");

    // Control: drop the discount and the same fixture breaches by the full
    // $1,000,000 — so the assertion above tracks the discount, not the fixture.
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "0" } });
    expect(breachText()).toContain("$1,000,000");
  });

  it("fires the exemption warning on the account-picker path too", () => {
    // Ruling 21: this read used to be sourceAccount-only, so on the add-gift
    // dialog (no sourceAccount) it valued every asset gift at $0 and the
    // warning could never fire — beside a preview quoting real dollars.
    renderForm({
      ledger: exhaustedLedger(2030),
      annualExclusionByYear: { 2030: 19_000 },
    });
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "acct-1" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });

    expect(breachText()).toContain("$700,000");
  });
});
