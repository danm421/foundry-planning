// @vitest-environment jsdom
//
// G6 / F42 — "Save Changes" used to throw away an in-progress grant.
//
// The grant editor saves through its own "Save Grant" button. The dialog's
// primary button saved the ACCOUNT and then called `onSuccess`, which closes
// the dialog and unmounts the editor with everything typed into it. Measured on
// the real form: a grant with a date, 10,000 shares and three hand-entered
// vesting rows produced exactly one PUT to /stock-option-accounts, ZERO POSTs
// to /grants, and one `onSuccess` — no prompt, no error, nothing saved.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AddAccountForm, {
  type AccountFormInitial,
  type AccountFormAutoSaveHandle,
} from "../add-account-form";

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
let onSuccess: ReturnType<typeof vi.fn<() => void>>;

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
  onSuccess = vi.fn();
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

async function renderForm(ref?: React.Ref<AccountFormAutoSaveHandle>) {
  render(
    <AddAccountForm
      ref={ref}
      clientId="client-123"
      category="stock_options"
      mode="edit"
      initial={EQUITY_INITIAL}
      familyMembers={[{ id: "fm-client", role: "client", firstName: "Alice" }]}
      entities={[]}
      onSuccess={onSuccess}
      onSubmitStateChange={(s) => { submitState = s; }}
    />,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await screen.findByRole("button", { name: /\+ Add grant/ });
}

/** Open the grant editor and type a grant with three vesting rows into it. */
async function typeAGrant() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /\+ Add grant/ }));
  });
  const editor = screen.getByText("Add Grant").closest("div") as HTMLElement;
  const grantDate = editor.querySelector('input[type="date"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(grantDate, { target: { value: "2025-01-01" } }); });
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. 10000"), { target: { value: "10000" } });
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add vest tranche/ }));
    });
  }
  return grantDate;
}

function submitForm() {
  const form = document.getElementById("add-account-form") as HTMLFormElement;
  return act(async () => { fireEvent.submit(form); });
}

describe("AddAccountForm — an in-progress grant is not thrown away (F42)", () => {
  it("saves and closes normally while no grant is being edited", async () => {
    // The control. Without it, every "did not save" assertion below would hold
    // even if the form were broken outright.
    await renderForm();
    expect(submitState?.canSubmit).toBe(true);

    fetchMock.mockClear();
    await submitForm();

    expect(writeCalls()).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("holds the dialog's primary button while a grant is being typed", async () => {
    await renderForm();
    await typeAGrant();

    expect(submitState?.canSubmit).toBe(false);
    expect(screen.getByTestId("grant-editor-open-hint")).toBeInTheDocument();
  });

  it("refuses an Enter-key submit, which bypasses the disabled button", async () => {
    await renderForm();
    const grantDate = await typeAGrant();

    fetchMock.mockClear();
    await submitForm();

    expect(writeCalls()).toEqual([]);
    expect(onSuccess).not.toHaveBeenCalled();
    // And the work is still on screen, not silently gone.
    expect(grantDate.value).toBe("2025-01-01");
    expect(document.querySelectorAll('table input[type="date"]')).toHaveLength(3);
    // Said twice on purpose: the standing hint on the Grants tab, and the
    // dialog's own error banner, which is the only feedback an Enter-key
    // submitter gets.
    const shown = screen.getAllByText(/before saving the account/i);
    expect(shown).toHaveLength(2);
    expect(shown.some((el) => el.getAttribute("data-testid") !== "grant-editor-open-hint")).toBe(true);
  });

  it("saves again once the grant editor is cancelled", async () => {
    await renderForm();
    await typeAGrant();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ })); });

    expect(submitState?.canSubmit).toBe(true);
    fetchMock.mockClear();
    await submitForm();

    expect(writeCalls()).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("still lets the tab-switch autosave through, so the advisor is not stranded", async () => {
    // The guard deliberately does not feed `canSave`: a tab switch leaves the
    // editor mounted, so nothing is lost, and blocking it would trap the
    // advisor on the Grants tab. This is the failure mode G5 hit from the
    // other side, and jsdom is the only place it is cheap to pin.
    const ref = createRef<AccountFormAutoSaveHandle>();
    await renderForm(ref);
    await typeAGrant();

    fetchMock.mockClear();
    let result: Awaited<ReturnType<AccountFormAutoSaveHandle["saveAsync"]>> | undefined;
    await act(async () => { result = await ref.current!.saveAsync(); });

    expect(result?.ok).toBe(true);
    expect(writeCalls()).toHaveLength(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
