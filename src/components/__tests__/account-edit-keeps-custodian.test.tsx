// @vitest-environment jsdom
/**
 * Edit Account opened from Net Worth or the Household Map hydrates through
 * `accountToInitial`. It never mapped custodian or last 4, so the form seeded
 * both as "" and every save — including the silent autosave on a tab switch —
 * PUT them back as null, wiping the import dedupe key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/map",
}));

import { accountToInitial, type AccountRow } from "../balance-sheet-view";
import AddAccountForm, { type AccountFormAutoSaveHandle } from "../forms/add-account-form";

const ROW: AccountRow = {
  id: "acct-1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: "250000",
  basis: "200000",
  growthRate: "0.07",
  owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
  custodian: "Brightwater Securities",
  accountNumberLast4: "3157",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (/savings-rules|allocations|holdings/.test(String(url)) ? [] : { id: "acct-1" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Edit Account keeps custodian and last 4", () => {
  it("accountToInitial hands both to the form", () => {
    expect(accountToInitial(ROW)).toMatchObject({
      custodian: "Brightwater Securities",
      accountNumberLast4: "3157",
    });
  });

  it("a tab-switch autosave PUTs them back unchanged", async () => {
    const formRef = createRef<AccountFormAutoSaveHandle>();
    render(
      <AddAccountForm
        ref={formRef}
        clientId="c1"
        category="taxable"
        mode="edit"
        initial={accountToInitial(ROW)}
        familyMembers={[{ id: "fm-c", role: "client", firstName: "Cooper" }]}
        entities={[]}
      />,
    );

    // The imperative handle is what useTabAutoSave calls on a tab switch.
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/clients/c1/accounts/acct-1" && init?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body)).toMatchObject({
        custodian: "Brightwater Securities",
        accountNumberLast4: "3157",
      });
    });
  });
});
