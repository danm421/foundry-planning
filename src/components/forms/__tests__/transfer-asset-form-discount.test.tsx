// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransferAssetForm, { type AccountOption } from "@/components/forms/transfer-asset-form";

const accounts: AccountOption[] = [
  {
    id: "acct-1", name: "Family LLC Units", value: 1_000_000, growthRate: 0,
    subType: "other", isDefaultChecking: false, ownerSummary: "Client 100%",
    trustPercent: 0, ownedByOtherEntity: false,
  },
];

type FormProps = React.ComponentProps<typeof TransferAssetForm>;

function formProps(over: Partial<FormProps> = {}): FormProps {
  return {
    trustId: "t1",
    clientId: "c1",
    trustGrantor: "client",
    accounts,
    projectionStartYear: 2026,
    currentYear: 2026,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
}

function renderForm(over: Partial<FormProps> = {}) {
  return render(<TransferAssetForm {...formProps(over)} />);
}

function discountInput(): HTMLInputElement {
  return screen.getByLabelText(/Valuation discount/i) as HTMLInputElement;
}

/** The parsed body of the first POST the form made. */
function postedBody(): Record<string, unknown> {
  const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return JSON.parse((init as RequestInit).body as string);
}

describe("TransferAssetForm — valuation discount", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "g1" }) }),
    );
  });

  it("no longer renders the disabled override-amount field", () => {
    renderForm();
    expect(screen.queryByLabelText(/Override amount/i)).toBeNull();
    expect(screen.queryByText(/Reserved for future valuation-discount support/i)).toBeNull();
  });

  it("shows a discounted line beneath the estimated value", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Percent to transfer/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });
    const line = screen.getByTestId("transfer-discounted-value").textContent ?? "";
    expect(line).toContain("$700,000");
  });

  it("posts valuationDiscount as a fraction", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Percent to transfer/i), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), { target: { value: "30" } });
    fireEvent.submit(document.getElementById("transfer-asset-form")!);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = postedBody();
    expect(body.valuationDiscount).toBeCloseTo(0.3, 6);
    // percent is the ownership fraction and must NOT absorb the discount.
    expect(body.percent).toBeCloseTo(0.25, 6);
    expect("amount" in body).toBe(false);
  });

  it("omits valuationDiscount entirely when the field is left blank", async () => {
    renderForm();
    fireEvent.submit(document.getElementById("transfer-asset-form")!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(postedBody().valuationDiscount ?? null).toBeNull();
  });

  it("prefills the discount from priorDiscounts for the selected account", () => {
    renderForm({ priorDiscounts: { "acct-1": 0.45 } });
    expect(discountInput().value).toBe("45");
  });

  it("clamps an out-of-range entry so the field and the saved value agree", async () => {
    // PercentInput hands back the typed string unchanged. Unclamped, "150"
    // would read as 150% in the field while the `< 100` save guard dropped it —
    // a discount shown and not stored.
    renderForm();
    const input = discountInput();

    fireEvent.change(input, { target: { value: "150" } });
    expect(input.value).toBe("99");
    expect(screen.getByTestId("transfer-discounted-value").textContent).toContain("99%");

    fireEvent.submit(document.getElementById("transfer-asset-form")!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(postedBody().valuationDiscount).toBeCloseTo(0.99, 6);
  });

  it("clamps a prefill that storage would allow but the field cannot round-trip", () => {
    // The column accepts up to 0.9999. Seeding "99.99" would show a discount
    // the save guard then refuses, so the seed is clamped like typed input.
    renderForm({ priorDiscounts: { "acct-1": 0.9999 } });
    expect(discountInput().value).toBe("99");
  });

  it("does not re-seed when the prefill map arrives mid-typing", () => {
    // The case `discountTouched` exists for: the gift fetch resolves after the
    // advisor has started typing and hands down a NEW priorDiscounts object,
    // re-running the prefill effect. The prefill is an initial value only, so
    // the entry must survive. Without the guard this re-seeds to "45".
    const { rerender } = renderForm({ priorDiscounts: {} });
    fireEvent.change(discountInput(), { target: { value: "20" } });

    rerender(<TransferAssetForm {...formProps({ priorDiscounts: { "acct-1": 0.45 } })} />);

    expect(discountInput().value).toBe("20");
  });
});
