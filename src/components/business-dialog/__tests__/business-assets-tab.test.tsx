// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BusinessAssetsTab from "../business-assets-tab";

// The tab now routes owner mutations through useScenarioWriter (→ useScenarioState),
// which reads the app-router context. Mock next/navigation so the hook resolves
// to base mode (no ?scenario=) and passes through to the mocked global.fetch.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/client-1/balance-sheet",
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const businessId = "biz-1";
const clientId = "client-1";

function makeAccount(over: Partial<{ id: string; name: string; value: number; parentAccountId: string | null; category: string }> = {}) {
  return {
    id: "acc-1",
    name: "Op Checking",
    value: 50_000,
    parentAccountId: businessId,
    category: "cash",
    owners: [] as Array<{ kind: "family_member"; familyMemberId: string; percent: number }>,
    ...over,
  };
}

describe("BusinessAssetsTab — list view", () => {
  it("lists only accounts whose parentAccountId matches the business", () => {
    const acc = makeAccount();
    const other = makeAccount({ id: "acc-2", name: "Personal Checking", parentAccountId: null });
    render(
      <BusinessAssetsTab
        clientId={clientId}
        businessId={businessId}
        businessName="Test LLC"
        allAccounts={[acc, other]}
        allLiabilities={[]}
        familyMembers={[]}
        hidden={false}
        onChanged={() => {}}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
      />,
    );
    expect(screen.getByText("Op Checking")).toBeInTheDocument();
    expect(screen.queryByText("Personal Checking")).not.toBeInTheDocument();
  });

  it("renders an empty state when no children exist", () => {
    render(
      <BusinessAssetsTab
        clientId={clientId}
        businessId={businessId}
        businessName="Test LLC"
        allAccounts={[]}
        allLiabilities={[]}
        familyMembers={[]}
        hidden={false}
        onChanged={() => {}}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
      />,
    );
    expect(screen.getByText(/No assets or liabilities/i)).toBeInTheDocument();
  });

  it("PUTs parentAccountId: null on remove and calls onChanged", async () => {
    const acc = makeAccount();
    const onChanged = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    render(
      <BusinessAssetsTab
        clientId={clientId}
        businessId={businessId}
        businessName="Test LLC"
        allAccounts={[acc]}
        allLiabilities={[]}
        familyMembers={[]}
        hidden={false}
        onChanged={onChanged}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /remove op checking/i });
    fireEvent.click(removeBtn);

    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${clientId}/accounts/${acc.id}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ parentAccountId: null }),
      }),
    );
  });

  it("PUTs parentAccountId (no owners) on confirmed reparent", async () => {
    const onChanged = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const standalone = {
      id: "acc-stand",
      name: "Standalone Checking",
      value: 25_000,
      category: "cash",
      parentAccountId: null,
      owners: [{ kind: "family_member" as const, familyMemberId: "fm-susan", percent: 1 }],
    };

    render(
      <BusinessAssetsTab
        clientId={clientId}
        businessId={businessId}
        businessName="Test LLC"
        allAccounts={[standalone]}
        allLiabilities={[]}
        familyMembers={[{ id: "fm-susan", firstName: "Susan" }]}
        hidden={false}
        onChanged={onChanged}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reassign existing asset/i }));
    fireEvent.click(screen.getByRole("button", { name: /standalone checking/i }));
    expect(screen.getByText(/Susan \(100%\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm reassign/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${clientId}/accounts/${standalone.id}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ parentAccountId: businessId }),
      }),
    );
  });
});
