// @vitest-environment jsdom
/**
 * AddTaxAdjustmentForm — the advisor-facing surface for "income that already
 * happened" (a completed Roth conversion, a banked bonus, a K-1). Two things
 * here carry real risk:
 *
 *  - `withheldValue` is dual-unit: dollars in "amount" mode, a 0..1 FRACTION
 *    in "percent" mode. An advisor types 22.5 meaning 22.5%; the API stores
 *    0.225. Get the conversion (or its inversion on edit-load) backwards and
 *    a withholding figure is silently 100x wrong.
 *  - The PUT route (Task 7) accepts `withheldMode` and `withheldValue`
 *    independently — sending mode alone against a row that already has a
 *    dollar `withheldValue` on it would reinterpret that dollar figure as a
 *    percent. This form must always send both keys together, on every
 *    submit, including when the advisor turns withholding back off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddTaxAdjustmentForm } from "../add-tax-adjustment-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "adj-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastPostBody() {
  const call = fetchMock.mock.calls.find(
    (args) => String(args[0]) === "/api/clients/client-123/tax-adjustments",
  );
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string);
}

function lastPutBody(adjustmentId: string) {
  const call = fetchMock.mock.calls.find(
    (args) => String(args[0]) === `/api/clients/client-123/tax-adjustments/${adjustmentId}`,
  );
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string);
}

// ── Test 1: all seven tax treatments render ────────────────────────────────

describe("AddTaxAdjustmentForm — tax treatment options", () => {
  it("renders all seven tax treatments as options", () => {
    render(
      <AddTaxAdjustmentForm clientId="client-123" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const select = screen.getByRole("combobox", { name: "Tax treatment" }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      "ordinary_income",
      "earned_income",
      "dividends",
      "capital_gains",
      "stcg",
      "qbi",
      "tax_exempt",
    ]);
  });
});

// ── Test 2: negative amount hides the "Tax already paid" control ──────────

describe("AddTaxAdjustmentForm — negative amount hides withholding", () => {
  it("shows the withheld control for a positive amount and hides it once the amount goes negative", () => {
    render(
      <AddTaxAdjustmentForm clientId="client-123" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const amountInput = screen.getByLabelText("Annual amount");

    fireEvent.change(amountInput, { target: { value: "500" } });
    expect(screen.getByRole("combobox", { name: "Tax already paid mode" })).toBeInTheDocument();

    fireEvent.change(amountInput, { target: { value: "-500" } });
    expect(screen.queryByRole("combobox", { name: "Tax already paid mode" })).not.toBeInTheDocument();
  });
});

// ── Test 3: percent mode submits a fraction ────────────────────────────────

describe("AddTaxAdjustmentForm — percent-mode submit", () => {
  it("submits withheldValue as a fraction: typing 22.5 sends 0.225", async () => {
    render(
      <AddTaxAdjustmentForm clientId="client-123" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Annual amount"), { target: { value: "10000" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tax already paid mode" }), {
      target: { value: "percent" },
    });
    fireEvent.change(screen.getByLabelText("Percent withheld"), { target: { value: "22.5" } });

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.withheldMode).toBe("percent");
    expect(body.withheldValue).toBeCloseTo(0.225, 10);
  });
});

// ── Test 4: editing a percent row inverts the fraction back to a percent ──

describe("AddTaxAdjustmentForm — percent-mode edit load", () => {
  it("renders 22.5, not 0.225, when loading an existing percent row", () => {
    render(
      <AddTaxAdjustmentForm
        clientId="client-123"
        existing={{
          id: "adj-1",
          taxType: "ordinary_income",
          name: "2026 Roth conversion",
          owner: "joint",
          annualAmount: 10000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
          startYearRef: null,
          endYearRef: null,
          withheldMode: "percent",
          withheldValue: 0.225,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const withheldInput = screen.getByLabelText("Percent withheld") as HTMLInputElement;
    expect(withheldInput.value).toBe("22.5");
    expect(withheldInput.value).not.toBe("0.225");
  });
});

// ── Test 5: an edit submit always carries both withheld keys ──────────────

describe("AddTaxAdjustmentForm — edit submit always sends both withheld fields", () => {
  it("sends withheldValue: 0 alongside withheldMode: 'none' when the advisor turns withholding off", async () => {
    render(
      <AddTaxAdjustmentForm
        clientId="client-123"
        existing={{
          id: "adj-1",
          taxType: "ordinary_income",
          name: "2026 bonus",
          owner: "joint",
          annualAmount: 10000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
          startYearRef: null,
          endYearRef: null,
          // Row already has a $5,000 withheldValue on it — the exact case the
          // PUT route would misread as a 500,000% rate if this form ever sent
          // withheldMode alone.
          withheldMode: "amount",
          withheldValue: 5000,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Tax already paid mode" }), {
      target: { value: "none" },
    });

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPutBody("adj-1");
    expect(body).toHaveProperty("withheldMode");
    expect(body).toHaveProperty("withheldValue");
    expect(body.withheldMode).toBe("none");
    expect(body.withheldValue).toBe(0);
  });
});

// ── Test 6: stale withheld state is not resubmitted once the amount goes
//    negative — the actual reproduction sequence, not just DOM visibility ──

describe("AddTaxAdjustmentForm — stale withheld state after amount goes negative", () => {
  it("forces withheldMode: 'none' and withheldValue: 0 when a percent value entered while positive is submitted after the amount is edited negative", async () => {
    render(
      <AddTaxAdjustmentForm clientId="client-123" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const amountInput = screen.getByLabelText("Annual amount");

    // Positive amount → switch to percent → enter a value. The control is
    // visible and its own onChange handlers set real React state here.
    fireEvent.change(amountInput, { target: { value: "10000" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tax already paid mode" }), {
      target: { value: "percent" },
    });
    fireEvent.change(screen.getByLabelText("Percent withheld"), { target: { value: "22.5" } });

    // Now flip the amount negative. The control disappears from the DOM, but
    // nothing has cleared withheldMode/withheldValue in state — they're only
    // ever touched by the (now-hidden) control's own handlers.
    fireEvent.change(amountInput, { target: { value: "-500" } });
    expect(screen.queryByRole("combobox", { name: "Tax already paid mode" })).not.toBeInTheDocument();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.annualAmount).toBe(-500);
    expect(body.withheldMode).toBe("none");
    expect(body.withheldValue).toBe(0);
  });
});

// ── Test 7: same reproduction, but the amount is cleared to blank ─────────

describe("AddTaxAdjustmentForm — stale withheld state after amount goes blank", () => {
  it("forces withheldMode: 'none' and withheldValue: 0 when the amount is cleared to blank after entering a percent value", async () => {
    render(
      <AddTaxAdjustmentForm clientId="client-123" onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const amountInput = screen.getByLabelText("Annual amount");

    fireEvent.change(amountInput, { target: { value: "10000" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tax already paid mode" }), {
      target: { value: "amount" },
    });
    fireEvent.change(screen.getByLabelText("Amount withheld"), { target: { value: "3000" } });

    // Blank, not negative — parseFloat("") is NaN, which a naive `<= 0` guard
    // would fail to catch (NaN > 0 and NaN <= 0 are both false).
    fireEvent.change(amountInput, { target: { value: "" } });
    expect(screen.queryByRole("combobox", { name: "Tax already paid mode" })).not.toBeInTheDocument();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPostBody();
    expect(body.annualAmount).toBe(0);
    expect(body.withheldMode).toBe("none");
    expect(body.withheldValue).toBe(0);
  });
});
