// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ProfileAccountsList from "../profile-accounts-list";

const BASE_ROW = {
  accountNumberLast4: null,
  plaidItemId: null,
  owners: [],
};

const rows = [
  { ...BASE_ROW, id: "1", name: "My Annuity Account", category: "annuity", subType: "other", value: "50000" },
  { ...BASE_ROW, id: "2", name: "My Stock Options", category: "stock_options", subType: "other", value: "25000" },
  { ...BASE_ROW, id: "3", name: "Mystery Future Account", category: "mystery_future_cat", subType: "other", value: "10000" },
];

const CLIENT_FM = { id: "fm1", firstName: "Dan", lastName: null, role: "client" };
const OWNED_BY_FM1 = [{ familyMemberId: "fm1", entityId: null, percent: "1" }];

describe("ProfileAccountsList", () => {
  it("renders annuity and stock_options accounts and their category headings", () => {
    const { container } = render(
      <ProfileAccountsList
        editEnabled={false}
        familyMembers={[]}
        trustEntities={[]}
        rows={rows}
      />,
    );

    // All three account names must appear — none silently dropped
    expect(container.textContent).toContain("My Annuity Account");
    expect(container.textContent).toContain("My Stock Options");
    expect(container.textContent).toContain("Mystery Future Account");

    // Category headings for the two newly-added categories must render
    expect(container.textContent).toContain("Annuity");
    expect(container.textContent).toContain("Stock options");
  });

  it("shows Plaid badge on Plaid-linked accounts and not on manual accounts", () => {
    const plaidRow = { ...BASE_ROW, id: "p1", name: "Chase Checking", category: "cash", subType: "checking", value: "5000", plaidItemId: "plaid-item-abc" };
    const manualRow = { ...BASE_ROW, id: "m1", name: "Manual Savings", category: "cash", subType: "savings", value: "2000" };
    const { container } = render(
      <ProfileAccountsList
        editEnabled={false}
        familyMembers={[]}
        trustEntities={[]}
        rows={[plaidRow, manualRow]}
      />,
    );
    // Plaid badge must appear once (for the linked account)
    const badges = container.querySelectorAll('[class*="bg-accent/10"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("Plaid");
  });

  it("shows Edit but not Delete on Plaid-linked rows when editEnabled", () => {
    const plaidRow = { ...BASE_ROW, id: "p2", name: "Plaid Brokerage", category: "taxable", subType: "brokerage", value: "10000", plaidItemId: "plaid-item-xyz" };
    const manualRow = { ...BASE_ROW, id: "m2", name: "Manual IRA", category: "retirement", subType: "traditional_ira", value: "30000" };
    const { getByText, queryAllByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[]}
        trustEntities={[]}
        rows={[plaidRow, manualRow]}
      />,
    );
    // Edit is now reachable on BOTH the manual and the Plaid row
    expect(queryAllByText("Edit").length).toBe(2);
    // Delete stays manual-only — unlink-first is correct for linked rows
    expect(queryAllByText("Delete").length).toBe(1);
    expect(getByText("Manual IRA")).toBeTruthy();
    expect(getByText("Plaid Brokerage")).toBeTruthy();
  });
});

describe("ProfileAccountsList — Plaid-aware edit form", () => {
  it("renders value and last4 read-only with a synced banner when editing a Plaid row", () => {
    const plaidRow = {
      id: "p3", name: "Chase Checking", category: "cash", subType: "checking",
      value: "5000", accountNumberLast4: "1234", plaidItemId: "item1", owners: OWNED_BY_FM1,
    };
    const { container, getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[plaidRow]}
      />,
    );
    fireEvent.click(getByText("Edit"));

    // Banner explaining why the fields are locked
    expect(container.textContent).toContain(
      "Balance and account number sync from your institution",
    );
    // Value renders read-only — no editable amount input in the open form
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();
    // Both locked fields (value + last4) carry the "Synced via Plaid" hint
    const hints = container.textContent?.match(/Synced via Plaid/g) ?? [];
    expect(hints.length).toBe(2);
  });

  it("keeps value and last4 editable when editing a manual row", () => {
    const manualRow = {
      id: "m3", name: "Manual Savings", category: "cash", subType: "savings",
      value: "2000", accountNumberLast4: "9999", plaidItemId: null, owners: OWNED_BY_FM1,
    };
    const { container, getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[manualRow]}
      />,
    );
    fireEvent.click(getByText("Edit"));

    // Editable Value amount input is present
    expect(container.querySelector('input[inputmode="decimal"]')).not.toBeNull();
    // No Plaid hint/banner on a manual account
    expect(container.textContent).not.toContain("Synced via Plaid");
  });
});

describe("ProfileAccountsList — PUT body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn<
      (url: string, init: { method: string; body: string }) => Promise<unknown>
    >(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("alert", vi.fn());
    return fetchMock;
  }

  it("omits value and last4 from the PUT body when saving a Plaid edit", () => {
    const fetchMock = stubFetch();
    const plaidRow = {
      id: "p4", name: "Chase Checking", category: "cash", subType: "checking",
      value: "5000", accountNumberLast4: "1234", plaidItemId: "item1", owners: OWNED_BY_FM1,
    };
    const { getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[plaidRow]}
      />,
    );
    fireEvent.click(getByText("Edit"));
    fireEvent.click(getByText("Save"));

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/accounts/p4");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Chase Checking");
    expect(body.category).toBe("cash");
    expect("value" in body).toBe(false);
    expect("last4" in body).toBe(false);
  });

  it("includes value and last4 in the PUT body when saving a manual edit", () => {
    const fetchMock = stubFetch();
    const manualRow = {
      id: "m4", name: "Manual Savings", category: "cash", subType: "savings",
      value: "2000", accountNumberLast4: "9999", plaidItemId: null, owners: OWNED_BY_FM1,
    };
    const { getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[manualRow]}
      />,
    );
    fireEvent.click(getByText("Edit"));
    fireEvent.click(getByText("Save"));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.value).toBe("2000");
    expect(body.last4).toBe("9999");
  });
});

describe("ProfileAccountsList — in-flight gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A controllable fetch whose promise we resolve only after asserting the
  // mid-flight disabled state. Returns the resolver so the test can settle it.
  function deferredFetch() {
    let resolve!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const promise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
      (r) => { resolve = r; },
    );
    const fetchMock = vi.fn(() => promise);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("alert", vi.fn());
    return { resolve };
  }

  it("disables Save and the row's Edit/Delete while a save is in flight", async () => {
    const { resolve } = deferredFetch();
    const manualRow = {
      id: "m5", name: "Manual Savings", category: "cash", subType: "savings",
      value: "2000", accountNumberLast4: "9999", plaidItemId: null, owners: OWNED_BY_FM1,
    };
    const { getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[manualRow]}
      />,
    );
    fireEvent.click(getByText("Edit"));
    const saveBtn = getByText("Save") as HTMLButtonElement;
    fireEvent.click(saveBtn);

    // Mid-flight: the save request has fired but not resolved. Every mutating
    // control must be locked so a second click can't double-submit.
    expect(saveBtn.disabled).toBe(true);
    expect((getByText("Edit") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Delete") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, json: async () => ({}) });
    });
  });

  it("disables row Edit/Delete and Add-account while a delete is in flight", async () => {
    const { resolve } = deferredFetch();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const manualRow = {
      id: "m6", name: "Manual Savings", category: "cash", subType: "savings",
      value: "2000", accountNumberLast4: "9999", plaidItemId: null, owners: OWNED_BY_FM1,
    };
    const { getByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[CLIENT_FM]}
        trustEntities={[]}
        rows={[manualRow]}
      />,
    );
    fireEvent.click(getByText("Delete"));

    expect((getByText("Edit") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Delete") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("+ Add account") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, json: async () => ({}) });
    });
  });
});
