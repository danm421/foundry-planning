// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
