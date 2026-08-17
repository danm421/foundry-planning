// @vitest-environment jsdom
//
// G6 — the ACCOUNT-level equity strategy on Account Details. The grant editor
// has its own copy of these rules; this file covers the defaults every grant
// inherits, which is where an unfilled companion does the most damage.
//
// Assertions are on the network calls the form makes and on `onSubmitStateChange`
// (the dialog's primary-button state). Both distinguish blocked from allowed —
// the panel itself stays mounted and jsdom never applies the hiding class.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AddAccountForm, { type AccountFormInitial } from "../add-account-form";

const refreshMock = vi.fn();
const searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/client-123/details/net-worth",
}));

const EQUITY_INITIAL: AccountFormInitial = {
  id: "acct-so",
  name: "Acme Stock Options",
  category: "stock_options",
  subType: "other",
  owner: "client",
  value: "0",
  basis: "0",
  growthRate: "0.08",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

let fetchMock: ReturnType<typeof vi.fn>;
let submitState: { canSubmit: boolean; loading: boolean } | null;

function writeCalls() {
  return fetchMock.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
    }))
    .filter((c) => c.method !== "GET");
}

beforeEach(() => {
  submitState = null;
  refreshMock.mockReset();
  fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("stock-option-accounts") && !u.includes("grants")) {
      return {
        ok: true,
        json: async () => ({
          stockOptionAccounts: [
            {
              account: { id: "acct-so" },
              extension: {
                ticker: "ACME", isPublic: true, pricePerShare: "50",
                autoCreateDestination: true, sellToCover: true, withholdingRate: "0.22",
                defaultExerciseTiming: "at_vest", defaultExerciseYear: null,
                defaultSellTiming: "hold", defaultSellYear: null,
                defaultSellPercentPerYear: null, defaultSellStartYear: null,
              },
            },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ id: "acct-so", grants: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderEquityForm() {
  render(
    <AddAccountForm
      clientId="client-123"
      category="stock_options"
      mode="edit"
      initial={EQUITY_INITIAL}
      familyMembers={[{ id: "fm-client", role: "client", firstName: "Alice" }]}
      entities={[]}
      onSubmitStateChange={(s) => { submitState = s; }}
    />,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  // Seeding is async; wait for the strategy select to carry the loaded value.
  const sell = document.getElementById("equity-defaultSellTiming") as HTMLSelectElement;
  await waitFor(() => expect(sell.value).toBe("hold"));
  return sell;
}

/** Submit the form and report whether it reached the API. */
async function submitAndCountWrites() {
  fetchMock.mockClear();
  const form = document.getElementById("add-account-form") as HTMLFormElement;
  await act(async () => { fireEvent.submit(form); });
  return writeCalls();
}

describe("Account equity strategy — \"Manual\" exercise timing (F18/F33)", () => {
  it("is not offered", async () => {
    await renderEquityForm();
    const ex = document.getElementById("equity-defaultExerciseTiming") as HTMLSelectElement;
    // Listing every option is the control: an empty or unrendered select would
    // also "not contain manual".
    expect(Array.from(ex.options).map((o) => o.value)).toEqual([
      "at_vest", "specific_year", "year_before_expiration",
    ]);
  });

  it("is still offered on an account that already holds it", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("stock-option-accounts")) {
        return {
          ok: true,
          json: async () => ({
            stockOptionAccounts: [{
              account: { id: "acct-so" },
              extension: {
                ticker: "ACME", isPublic: true, pricePerShare: "50",
                autoCreateDestination: true, sellToCover: true, withholdingRate: "0.22",
                defaultExerciseTiming: "manual", defaultExerciseYear: null,
                defaultSellTiming: "hold", defaultSellYear: null,
                defaultSellPercentPerYear: null, defaultSellStartYear: null,
              },
            }],
          }),
        };
      }
      return { ok: true, json: async () => ({ id: "acct-so", grants: [] }) };
    });
    render(
      <AddAccountForm
        clientId="client-123"
        category="stock_options"
        mode="edit"
        initial={EQUITY_INITIAL}
        familyMembers={[{ id: "fm-client", role: "client", firstName: "Alice" }]}
        entities={[]}
      />,
    );
    const ex = document.getElementById("equity-defaultExerciseTiming") as HTMLSelectElement;
    await waitFor(() => expect(ex.value).toBe("manual"));
    expect(Array.from(ex.options).map((o) => o.value)).toContain("manual");
  });
});

describe("Account equity strategy — a timing needs its companion (F29/F40)", () => {
  it("saves normally while the strategy is complete", async () => {
    // The control: without this, a test that asserts "no write" proves nothing.
    await renderEquityForm();
    expect(submitState?.canSubmit).toBe(true);
    expect(await submitAndCountWrites()).toHaveLength(1);
  });

  it("blocks hold-then-sell with a blank year", async () => {
    const sell = await renderEquityForm();
    await act(async () => { fireEvent.change(sell, { target: { value: "hold_then_sell_year" } }); });

    expect(submitState?.canSubmit).toBe(false);
    expect(screen.getByTestId("equity-strategy-incomplete")).toBeInTheDocument();
    // Enter-key submits bypass the disabled button, so the handler must refuse too.
    expect(await submitAndCountWrites()).toEqual([]);
  });

  it("unblocks once the year is filled in", async () => {
    const sell = await renderEquityForm();
    await act(async () => { fireEvent.change(sell, { target: { value: "hold_then_sell_year" } }); });
    const year = document.getElementById("equity-defaultSellYear") as HTMLInputElement;
    await act(async () => { fireEvent.change(year, { target: { value: "2032" } }); });

    expect(submitState?.canSubmit).toBe(true);
    expect(screen.queryByTestId("equity-strategy-incomplete")).toBeNull();
    expect(await submitAndCountWrites()).toHaveLength(1);
  });

  it("blocks percent-per-year with a blank percentage", async () => {
    const sell = await renderEquityForm();
    await act(async () => { fireEvent.change(sell, { target: { value: "percent_per_year" } }); });

    expect(submitState?.canSubmit).toBe(false);
    expect(await submitAndCountWrites()).toEqual([]);
  });

  it("blocks a specific exercise year with a blank year", async () => {
    await renderEquityForm();
    const ex = document.getElementById("equity-defaultExerciseTiming") as HTMLSelectElement;
    await act(async () => { fireEvent.change(ex, { target: { value: "specific_year" } }); });

    expect(submitState?.canSubmit).toBe(false);
    expect(await submitAndCountWrites()).toEqual([]);
  });
});
