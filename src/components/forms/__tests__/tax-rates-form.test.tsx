// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TaxRatesForm from "../tax-rates-form";
import { ClientAccessProvider } from "@/components/client-access-provider";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  clientId: "test-client-id",
  flatFederalRate: "0.24",
  flatStateRate: "0.05",
  estateAdminExpenses: "0",
  flatStateEstateRate: "0",
  residenceState: null,
  irdTaxRate: "0.37",
  probateCostRate: "0.03",
  pvDiscountRate: "",
  lifetimeExemptionCap: "",
  outOfHouseholdDniRate: "0.37",
  priorTaxableGiftsClient: "0",
  priorTaxableGiftsSpouse: "0",
  hasSpouse: false,
  clientFirstName: "Alice",
};

function renderForm(overrides?: Partial<typeof BASE_PROPS>) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <TaxRatesForm {...BASE_PROPS} {...overrides} />
    </ClientAccessProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaxRatesForm — Lifetime exemption cap field", () => {
  it("renders the lifetime exemption cap field with its prefilled value", () => {
    renderForm({ lifetimeExemptionCap: "20000000" });
    // CurrencyInput renders a visible text input (no name attr) showing the
    // comma-formatted value, plus a hidden input with name="lifetimeExemptionCap"
    // holding the raw numeric string. FieldRow uses <span> not <label>, so
    // getByLabelText would not find the input. Instead use getByDisplayValue
    // which verifies both that the field is present AND that the prefilled value
    // is formatted correctly.
    const input = screen.getByDisplayValue("20,000,000") as HTMLInputElement;
    expect(input.value).toBe("20,000,000");
  });

  it("renders with empty value when lifetimeExemptionCap is blank", () => {
    renderForm({ lifetimeExemptionCap: "" });
    // The visible input should show the placeholder or empty string.
    // Verify no stale value from other CurrencyInput fields bleeds in.
    const hiddenInput = document.querySelector(
      'input[type="hidden"][name="lifetimeExemptionCap"]',
    ) as HTMLInputElement | null;
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput?.value).toBe("");
  });
});

describe("TaxRatesForm — PV discount rate field", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the prefilled percent value from a persisted decimal fraction", () => {
    renderForm({ pvDiscountRate: "0.04" });
    const input = document.getElementById("pvDiscountRate") as HTMLInputElement;
    expect(input.value).toBe("4.00");
  });

  it("renders blank (not '0.00') when pvDiscountRate is unset", () => {
    renderForm({ pvDiscountRate: "" });
    const input = document.getElementById("pvDiscountRate") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("submits a typed percent value as a decimal fraction, mirroring probateCostRate", async () => {
    const { container } = renderForm({ pvDiscountRate: "" });

    const input = document.getElementById("pvDiscountRate") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.pvDiscountRate).toBe("0.05");
  });

  it("submits null (not 0) when left blank", async () => {
    const { container } = renderForm({ pvDiscountRate: "" });

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.pvDiscountRate).toBeNull();
  });
});
