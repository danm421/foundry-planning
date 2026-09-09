// @vitest-environment jsdom
//
// The Details → Family gift dialog and the valuation discount.
//
// This surface used to pass `showValuationDiscount={false}`: `AccountLite`
// carried no `value`/`subType` and `toEditingDraft` could not read a saved
// discount, so the field would have printed a flat "0%" over a gift that
// actually carries one — a false §709 figure in a transfer-tax dialog. The
// column is plumbed through now, so these lock the two halves that matter:
// the saved discount must SEED the field, and a save must not silently clear
// it — nor silently keep one the advisor cleared on purpose.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type {
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
  Gift,
  GiftSeriesLite,
} from "@/components/family-view";

const baseProps = {
  clientId: "c1",
  scenarioId: "s1",
  hasSpouse: true,
  members: [
    { id: "m1", firstName: "Jane", lastName: "Doe", role: "child" },
  ] as unknown as FamilyMember[],
  externals: [] as unknown as ExternalBeneficiary[],
  entities: [
    { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true },
  ] as unknown as Entity[],
  accounts: [
    {
      id: "a1",
      name: "Whatnot LLC",
      category: "business",
      value: 100_000,
      subType: "business",
      ownerFamilyMemberId: "m0",
      ownerEntityId: null,
    },
  ] as unknown as AccountLite[],
  annualExclusionByYear: { 2026: 19000 },
  onClose: vi.fn(),
  onSavedGift: vi.fn(),
  onSavedSeries: vi.fn(),
};

/** A saved in-kind gift carrying a 30% discount. */
const discountedGift: Gift = {
  id: "g1",
  year: 2026,
  amount: null,
  grantor: "client",
  recipientEntityId: "t1",
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  accountId: "a1",
  percent: 0.15,
  valuationDiscount: 0.3,
  useCrummeyPowers: false,
  notes: null,
};

const discountedSeries: GiftSeriesLite = {
  id: "s1",
  grantor: "client",
  recipientEntityId: "t1",
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  startYear: 2026,
  endYear: 2030,
  annualAmount: 19000,
  amountMode: "fixed",
  inflationAdjust: false,
  valuationDiscount: 0.25,
  useCrummeyPowers: true,
};

const discountField = () =>
  screen.getByLabelText(/Valuation discount/i) as HTMLInputElement;

function mockSave(row: Record<string, unknown>) {
  return vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(row), { status: 200 }),
  );
}

/** The JSON body of the first fetch the dialog issued. */
function sentBody(fetchMock: ReturnType<typeof mockSave>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

describe("GiftDialog — valuation discount round-trip", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("seeds the field from the SAVED discount, not a flat 0%", () => {
    // The bug this whole change exists for: the field read 0% over a gift
    // carrying 30%.
    render(<GiftDialog {...baseProps} editingGift={discountedGift} />);
    expect(discountField().value).toBe("30");
  });

  it("seeds a series edit from its saved discount", () => {
    render(<GiftDialog {...baseProps} editingSeries={discountedSeries} />);
    expect(discountField().value).toBe("25");
  });

  it("previews the discounted value, which needs the account value this surface now carries", () => {
    render(<GiftDialog {...baseProps} editingGift={discountedGift} />);
    // 15% of $100,000 = $15,000 full value; a 30% discount leaves $10,500.
    const preview = screen.getByTestId("discount-preview");
    expect(preview.textContent).toContain("$15,000");
    expect(preview.textContent).toContain("$10,500");
  });

  it("preserves the saved discount through an unrelated edit", async () => {
    const fetchMock = mockSave({ ...discountedGift, percent: "0.2", valuationDiscount: "0.3" });
    render(<GiftDialog {...baseProps} editingGift={discountedGift} />);
    fireEvent.change(screen.getByLabelText(/percent/i, { selector: "input" }), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock).valuationDiscount).toBeCloseTo(0.3, 4);
  });

  it("clears the column when the advisor zeroes the field", async () => {
    // Was a silent no-op while the field was suppressed: an omitted field
    // leaves the row alone, so Save looked dead.
    const fetchMock = mockSave({ ...discountedGift, valuationDiscount: null });
    render(<GiftDialog {...baseProps} editingGift={discountedGift} />);
    fireEvent.change(discountField(), { target: { value: "0" } });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sentBody(fetchMock);
    expect("valuationDiscount" in body).toBe(true);
    expect(body.valuationDiscount).toBeNull();
  });

  it("reports the saved discount back to the list, so a re-open is not stale", async () => {
    const onSavedGift = vi.fn();
    mockSave({ ...discountedGift, valuationDiscount: "0.3", percent: "0.15" });
    render(
      <GiftDialog {...baseProps} editingGift={discountedGift} onSavedGift={onSavedGift} />,
    );
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(onSavedGift).toHaveBeenCalled());
    expect(onSavedGift.mock.calls[0][0].valuationDiscount).toBeCloseTo(0.3, 4);
  });

  it("omits the field entirely for a one-time cash gift to an individual", async () => {
    // The approved gate hides the field on that shape, so an empty draft
    // discount means "never asked" — the row must be left alone, not cleared.
    const cashToIndividual: Gift = {
      ...discountedGift,
      accountId: null,
      percent: null,
      amount: 19000,
      recipientEntityId: null,
      recipientFamilyMemberId: "m1",
      valuationDiscount: 0.3,
    };
    const fetchMock = mockSave({ ...cashToIndividual, amount: "20000" });
    render(<GiftDialog {...baseProps} editingGift={cashToIndividual} />);
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect("valuationDiscount" in sentBody(fetchMock)).toBe(false);
  });
});
