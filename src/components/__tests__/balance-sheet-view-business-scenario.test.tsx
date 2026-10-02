// @vitest-environment jsdom
/**
 * Focus mode inside a scenario: the business editors reach the scenario only.
 * The REAL `useScenarioWriter` runs here (`?scenario=` from the mocked search
 * params) and every request is recorded, so each test asserts the WHOLE request
 * list (R1): scenario changes only — never a bare `/accounts` call or `/notes`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=sc1"),
  usePathname: () => "/clients/c1/solver",
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import BalanceSheetView, { type AccountRow } from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

const FM = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";
const CHANGES = "/api/clients/c1/scenarios/sc1/changes";
const OWNERS = [{ kind: "family_member" as const, familyMemberId: FM, percent: 1 }];

const BUSINESS: AccountRow = {
  id: BIZ,
  name: "Acme Widgets LLC",
  category: "business",
  subType: "llc",
  owner: "client",
  value: "500000",
  basis: "100000",
  growthRate: null,
  owners: OWNERS,
  businessType: "llc",
  businessTaxTreatment: "qbi",
  notes: "old",
};

const fetchMock = vi.fn();
// Side-data GETs the dialog makes on open are not writes; keep only the writes.
const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method)
    .map(([url, init]) => ({
      url: url as string,
      method: (init as RequestInit).method,
      body: (init as RequestInit).body ? JSON.parse((init as RequestInit).body as string) : undefined,
    }));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: init?.method === "POST" ? 201 : 200,
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderFocused(focus: EditorFocus, onFocusClose = vi.fn()) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <BalanceSheetView
        clientId="c1"
        accounts={[BUSINESS]}
        liabilities={[]}
        entities={[]}
        familyMembers={[{ id: FM, role: "client", firstName: "Alice" }]}
        categoryDefaults={{
          taxable: "0.07", cash: "0.02", retirement: "0.07", annuity: "0.05",
          real_estate: "0.04", business: "0.06", stock_options: "0.07",
          life_insurance: "0.03", notes_receivable: "0.05", education_savings: "0.07",
        }}
        ownerNames={{ clientName: "Alice Test", spouseName: null }}
        focus={focus}
        onFocusClose={onFocusClose}
      />
    </ClientAccessProvider>,
  );
  return { onFocusClose };
}

describe("BalanceSheetView focus — business, inside a scenario", () => {
  it("delete → ONE scenario remove, closes silently", async () => {
    const { onFocusClose } = renderFocused({ intent: "delete", kind: "account", id: BIZ });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(writes()).toEqual([
      { url: CHANGES, method: "POST", body: { op: "remove", targetKind: "account", targetId: BIZ } },
    ]);
  });

  it("edit → Save posts ONE scenario edit, then closes", async () => {
    const { onFocusClose } = renderFocused({ kind: "account", id: BIZ });

    fireEvent.change(document.getElementById("biz-name")!, { target: { value: "Acme Holdings" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    const list = writes();
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe(CHANGES);
    expect(list[0].body).toMatchObject({
      op: "edit",
      targetKind: "account",
      targetId: BIZ,
      desiredFields: { name: "Acme Holdings" },
    });
  });

  it("create → Add posts the business and its checking child, both scenario adds", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "account", variant: "business" });

    fireEvent.change(document.getElementById("biz-name")!, { target: { value: "New Co" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Business" }));
    });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    const list = writes();
    expect(list.map((w) => [w.url, w.method, w.body.op, w.body.targetKind])).toEqual([
      [CHANGES, "POST", "add", "account"],
      [CHANGES, "POST", "add", "account"],
    ]);
    expect(list[1].body.entity.parentAccountId).toBe(list[0].body.entity.id);
  });
});
