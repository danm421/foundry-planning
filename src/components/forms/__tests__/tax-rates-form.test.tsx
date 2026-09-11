// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TaxRatesForm from "../tax-rates-form";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { USPSStateCode } from "@/lib/usps-states";

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
  residenceState: null as USPSStateCode | null,
  irdTaxRate: "0.37",
  probateCostRate: "0.03",
  pvDiscountRate: "",
  lifetimeExemptionCap: "",
  outOfHouseholdDniRate: "0.37",
  priorTaxableGiftsClient: "0",
  priorTaxableGiftsSpouse: "0",
  coveredByWorkplacePlan: "auto" as const,
  spouseCoveredByWorkplacePlan: "auto" as const,
  capitalLossCarryforwardSt: "0",
  capitalLossCarryforwardLt: "0",
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

/** The form debounces before it saves; fake timers let a test step past that
 *  without a real wait. */
async function settleAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaxRatesForm — Lifetime exemption cap field", () => {
  it("renders the lifetime exemption cap field with its prefilled value", () => {
    renderForm({ lifetimeExemptionCap: "20000000" });
    const input = screen.getByDisplayValue("20,000,000") as HTMLInputElement;
    expect(input.value).toBe("20,000,000");
  });

  it("renders with empty value when lifetimeExemptionCap is blank", () => {
    renderForm({ lifetimeExemptionCap: "" });
    const input = document.getElementById("lifetimeExemptionCap") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("");
  });
});

describe("TaxRatesForm — autosave", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("has no Save button — the form saves on change", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByText(/changes save automatically/i)).toBeInTheDocument();
  });

  it("sends only the field that changed, so an untouched setting is never rewritten", async () => {
    renderForm({ probateCostRate: "0.03" });

    fireEvent.change(document.getElementById("probateCostRate")!, { target: { value: "4" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = bodyOf(fetchMock);
    expect(body).toEqual({ probateCostRate: "0.04" });
  });

  it("coalesces a burst of edits into one request", async () => {
    renderForm();

    fireEvent.change(document.getElementById("irdTaxRate")!, { target: { value: "35" } });
    fireEvent.change(document.getElementById("probateCostRate")!, { target: { value: "2" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toEqual({ irdTaxRate: "0.35", probateCostRate: "0.02" });
  });

  it("withholds a half-typed value rather than writing a NaN", async () => {
    renderForm();

    // "-" is a legal keystroke on the way to "-1" but is not yet a number.
    fireEvent.change(document.getElementById("irdTaxRate")!, { target: { value: "-" } });
    await settleAutosave();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected save instead of leaving a value that never landed", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "probateCostRate must be between 0 and 1" }),
    });
    renderForm();

    fireEvent.change(document.getElementById("probateCostRate")!, { target: { value: "400" } });
    await settleAutosave();

    await waitFor(() =>
      expect(screen.getByText(/probateCostRate must be between 0 and 1/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("flushes a pending edit when the tab that owns the form unmounts", async () => {
    const { unmount } = renderForm();

    fireEvent.change(document.getElementById("irdTaxRate")!, { target: { value: "35" } });
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toEqual({ irdTaxRate: "0.35" });
  });
});

describe("TaxRatesForm — PV discount rate field", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("saves a typed percent value as a decimal fraction, mirroring probateCostRate", async () => {
    renderForm({ pvDiscountRate: "" });

    fireEvent.change(document.getElementById("pvDiscountRate")!, { target: { value: "5" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).pvDiscountRate).toBe("0.05");
  });

  it("saves null (not 0) when cleared back to blank", async () => {
    renderForm({ pvDiscountRate: "0.04" });

    fireEvent.change(document.getElementById("pvDiscountRate")!, { target: { value: "" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).pvDiscountRate).toBeNull();
  });
});

describe("TaxRatesForm — workplace-plan coverage overrides (Task 10)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the client select with the persisted value inside the shared canEdit-gated fieldset (not a second, invented disabled mechanism) — kills a mutant that moves the select outside the fieldset or drops the fieldset's disabled binding", () => {
    const { rerender } = render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <TaxRatesForm {...BASE_PROPS} coveredByWorkplacePlan="yes" />
      </ClientAccessProvider>,
    );
    let select = document.getElementById("coveredByWorkplacePlan") as HTMLSelectElement;
    expect(select.value).toBe("yes");
    // jsdom doesn't implement the fieldset-disabled cascade onto descendant
    // controls' own `.disabled` IDL property, so assert on the fieldset
    // ancestor itself — this is exactly the mechanism R6 requires reusing.
    const fieldset = select.closest("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.disabled).toBe(true);

    rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm {...BASE_PROPS} coveredByWorkplacePlan="yes" />
      </ClientAccessProvider>,
    );
    select = document.getElementById("coveredByWorkplacePlan") as HTMLSelectElement;
    expect(select.closest("fieldset")?.disabled).toBe(false);
  });

  it("does not render the co-client select when hasSpouse is false, and renders it with its own persisted value when true — kills a mutant that always renders it or ignores hasSpouse", () => {
    const { rerender } = render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm {...BASE_PROPS} hasSpouse={false} spouseCoveredByWorkplacePlan="no" />
      </ClientAccessProvider>,
    );
    expect(document.getElementById("spouseCoveredByWorkplacePlan")).toBeNull();

    rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm {...BASE_PROPS} hasSpouse={true} spouseCoveredByWorkplacePlan="no" spouseFirstName="Beth" />
      </ClientAccessProvider>,
    );
    const spouseSelect = document.getElementById("spouseCoveredByWorkplacePlan") as HTMLSelectElement;
    expect(spouseSelect).not.toBeNull();
    expect(spouseSelect.value).toBe("no");
  });

  it("saves distinct client/co-client values independently — kills a mutant that conflates the two fields or drops one of them (both start at the same default, so only a per-field, distinct-value check catches a dropped or swapped column)", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm
          {...BASE_PROPS}
          hasSpouse={true}
          coveredByWorkplacePlan="auto"
          spouseCoveredByWorkplacePlan="auto"
          spouseFirstName="Beth"
        />
      </ClientAccessProvider>,
    );

    fireEvent.change(document.getElementById("coveredByWorkplacePlan")!, { target: { value: "yes" } });
    fireEvent.change(document.getElementById("spouseCoveredByWorkplacePlan")!, { target: { value: "no" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock);
    expect(body.coveredByWorkplacePlan).toBe("yes");
    expect(body.spouseCoveredByWorkplacePlan).toBe("no");
  });

  it("never sends a co-client value the page didn't render — a co-client-less household leaves the column alone rather than resetting it", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <TaxRatesForm {...BASE_PROPS} hasSpouse={false} />
      </ClientAccessProvider>,
    );

    fireEvent.change(document.getElementById("coveredByWorkplacePlan")!, { target: { value: "yes" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).not.toHaveProperty("spouseCoveredByWorkplacePlan");
  });
});

describe("TaxRatesForm — state of residence", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The page used to mirror residence across an Income-Tax select and an
  // Estate-Tax select. One control, one value: a second picker is the bug.
  it("renders exactly one residence picker", () => {
    renderForm({ residenceState: "WA" });
    expect(document.querySelectorAll("select#residenceState")).toHaveLength(1);
    expect(document.getElementById("residenceStateIncome")).toBeNull();
  });

  it("summarises the selected state's estate rules under the picker", async () => {
    renderForm({ residenceState: null });
    const summary = () => document.getElementById("residenceState-summary")!.textContent ?? "";
    expect(summary()).toMatch(/no state set/i);

    fireEvent.change(document.getElementById("residenceState")!, { target: { value: "WA" } });
    await settleAutosave();

    // Washington: a real state estate tax, so the exemption and top rate show.
    expect(summary()).toMatch(/exemption · top/);
    // Florida: no estate or inheritance tax at all — the summary has to say so
    // rather than carrying Washington's numbers forward.
    fireEvent.change(document.getElementById("residenceState")!, { target: { value: "FL" } });
    expect(summary()).toMatch(/no state estate or inheritance tax/i);

    await waitFor(() => expect(bodyOf(fetchMock).residenceState).toBe("WA"));
  });

  it("saves null when cleared back to unset", async () => {
    renderForm({ residenceState: "WA" });

    fireEvent.change(document.getElementById("residenceState")!, { target: { value: "" } });
    await settleAutosave();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).residenceState).toBeNull();
  });
});

describe("TaxRatesForm — calculation method", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides the flat federal rate in bracket mode, where the engine ignores it", async () => {
    renderForm({ initialMode: "flat" } as Partial<typeof BASE_PROPS>);
    expect(document.getElementById("flatFederalRate")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /bracket-based/i }));
    expect(document.getElementById("flatFederalRate")).toBeNull();

    await settleAutosave();
    await waitFor(() => expect(bodyOf(fetchMock).taxEngineMode).toBe("bracket"));
  });

  it("swaps the flat state rate for the state's name once brackets are driving it", () => {
    renderForm({ residenceState: "CA", initialMode: "bracket" } as Partial<typeof BASE_PROPS>);

    expect(document.getElementById("flatStateRate")).toBeNull();
    expect(screen.getByText("California brackets")).toBeInTheDocument();
  });

  it("keeps the flat state rate wherever it is still the rate in use — flat mode, or bracket mode with no state set", () => {
    // Flat mode ignores the state's brackets entirely.
    const { unmount } = renderForm({ residenceState: "CA", initialMode: "flat" } as Partial<typeof BASE_PROPS>);
    expect(document.getElementById("flatStateRate")).not.toBeNull();
    expect(screen.queryByText("California brackets")).toBeNull();
    unmount();

    // Bracket mode with no residence falls back to the flat rate, so it stays
    // editable — hiding it here would strand the only state rate the plan has.
    renderForm({ residenceState: null, initialMode: "bracket" } as Partial<typeof BASE_PROPS>);
    expect(document.getElementById("flatStateRate")).not.toBeNull();
  });

  it("follows the residence picker without a reload — picking a state mid-session retires the percent box", async () => {
    renderForm({ residenceState: null, initialMode: "bracket" } as Partial<typeof BASE_PROPS>);
    expect(document.getElementById("flatStateRate")).not.toBeNull();

    fireEvent.change(document.getElementById("residenceState")!, { target: { value: "CA" } });

    expect(document.getElementById("flatStateRate")).toBeNull();
    expect(screen.getByText("California brackets")).toBeInTheDocument();
    await settleAutosave();
  });
});

describe("TaxRatesForm — capital-loss carryforward field help", () => {
  it("quotes the $3,000 §1211(b) limit by default", () => {
    renderForm();
    const tips = screen.getAllByText(/Offsets future gains/);
    // Both the short-term and long-term fields carry the help.
    expect(tips).toHaveLength(2);
    for (const t of tips) {
      expect(t.textContent).toContain("$3,000");
    }
  });

  it("quotes the $1,500 limit for married-filing-separately", () => {
    renderForm({ filingStatus: "married_separate" } as Partial<typeof BASE_PROPS>);
    const tips = screen.getAllByText(/Offsets future gains/);
    expect(tips).toHaveLength(2);
    for (const t of tips) {
      expect(t.textContent).toContain("$1,500");
      expect(t.textContent).not.toContain("$3,000");
    }
  });

  it("wires each help badge to its copy so a screen reader hears more than 'Show help'", () => {
    renderForm();
    const badge = screen.getAllByRole("button", { name: "Show help" })[0];
    const describedBy = badge.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
  });
});
