// @vitest-environment jsdom
//
// G5 / F14 + F19 — "a what-if edit is a permanent edit".
//
// Equity was the ONE account category whose writes skipped the scenario writer:
// both save paths short-circuit on `category === "stock_options"` and fetch the
// dedicated `/stock-option-accounts` routes, which resolve the BASE-case
// scenario id server-side. So an edit made while viewing a scenario rewrote the
// base plan (and therefore every other scenario), with no `scenario_change` row
// in the Changes panel and no undo.
//
// These tests drive the REAL <AddAccountForm> with `?scenario=` set and assert
// on the network calls it makes — the only place the bypass is observable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AddAccountForm, {
  type AccountFormInitial,
  type AccountFormAutoSaveHandle,
} from "../add-account-form";

const refreshMock = vi.fn();

// `?scenario=scn-1` is what makes `useScenarioWriter().scenarioActive` true.
let searchParams = new URLSearchParams("scenario=scn-1");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/client-123/details/net-worth",
}));

const CLIENT_FM = { id: "fm-client", role: "client" as const, firstName: "Alice" };
const FAMILY_MEMBERS = [CLIENT_FM];

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

/** Every non-GET call the form made, in order. */
function writeCalls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchMock.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
      body: (() => {
        const b = (init as RequestInit | undefined)?.body;
        return typeof b === "string" ? JSON.parse(b) : b;
      })(),
    }))
    .filter((c) => c.method !== "GET");
}

beforeEach(() => {
  searchParams = new URLSearchParams("scenario=scn-1");
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
                ticker: "ACME",
                isPublic: true,
                pricePerShare: "50",
                autoCreateDestination: true,
                sellToCover: true,
                withholdingRate: "0.22",
                defaultExerciseTiming: "at_vest",
                defaultExerciseYear: null,
                defaultSellTiming: "hold",
                defaultSellYear: null,
                defaultSellPercentPerYear: null,
                defaultSellStartYear: null,
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

function renderEquityForm(ref?: React.Ref<AccountFormAutoSaveHandle>) {
  return render(
    <AddAccountForm
      ref={ref}
      clientId="client-123"
      category="stock_options"
      mode="edit"
      initial={EQUITY_INITIAL}
      familyMembers={FAMILY_MEMBERS}
      entities={[]}
    />,
  );
}

describe("AddAccountForm — equity edits inside a scenario (F14/F19)", () => {
  it("does not write to the base-case stock-option-accounts route on submit", async () => {
    renderEquityForm();

    // Let the edit-mode seeding fetch settle so the reads are out of the way.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();

    const form = document.getElementById("add-account-form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
    });

    // The bug: exactly one PUT to /stock-option-accounts/acct-so, which the
    // route writes into the BASE case, and zero scenario-change rows.
    expect(writeCalls()).toEqual([]);
  });

  it("does not write on the tab-switch autosave path either", async () => {
    const ref = createRef<AccountFormAutoSaveHandle>();
    renderEquityForm(ref);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();

    let result: Awaited<ReturnType<AccountFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => {
      result = await ref.current!.saveAsync();
    });

    expect(writeCalls()).toEqual([]);
    expect(result?.ok).toBe(false);
  });

  it("tells the advisor why, instead of silently editing the base plan", async () => {
    renderEquityForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(
      screen.getByText(/Stock options are edited on the base plan/i),
    ).toBeInTheDocument();
  });

  it("still lets the advisor reach the Grants tab", async () => {
    // Caught in the browser, not in jsdom: edit-mode seeding leaves the form
    // dirty, so every tab click ran the autosave, the autosave refused, and the
    // advisor was stranded on Account Details — unable to even LOOK at the
    // grants inside a scenario. Blocking writes must not block navigation.
    renderEquityForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Dirty the form first — the tab guard only engages on a DIRTY form, so a
    // clean one navigates freely and would prove nothing. (Account Name sits
    // outside the disabled equity fieldset, which is what makes it reachable.)
    const nameInput = screen.getByDisplayValue("Acme Stock Options");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Acme Stock Options v2" } });
    });
    fetchMock.mockClear();

    const grantsTab = screen.getByRole("button", { name: /^Grants$/ });
    await act(async () => {
      fireEvent.click(grantsTab);
    });

    // Assert the tab actually BECAME ACTIVE. Every tab panel stays mounted and
    // is hidden with a Tailwind class, which jsdom does not apply — so
    // `getByText` on the panel's contents finds it either way and can never
    // fail. The active-tab styling is the only observable signal here.
    expect(grantsTab.className).toContain("border-accent");
    expect(writeCalls()).toEqual([]);
  });

  it("disables the equity fields so they cannot be dirtied", async () => {
    renderEquityForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // `<fieldset disabled>` marks every descendant control actually-disabled.
    const ticker = document.getElementById("equity-ticker") as HTMLInputElement;
    expect(ticker.closest("fieldset")).toBeDisabled();
  });
});

describe("AddAccountForm — equity edits with NO scenario active", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("");
  });

  it("still saves straight through to the stock-option-accounts route", async () => {
    renderEquityForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();

    const form = document.getElementById("add-account-form") as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
    });

    const writes = writeCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("PUT");
    expect(writes[0].url).toContain("/stock-option-accounts/acct-so");
  });
});
