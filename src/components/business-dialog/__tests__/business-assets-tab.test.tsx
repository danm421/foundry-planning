// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BusinessAssetsTab from "../business-assets-tab";

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
        accounts={[acc, other]}
        liabilities={[]}
        hidden={false}
        onChanged={() => {}}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
        onOpenReparentPicker={() => {}}
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
        accounts={[]}
        liabilities={[]}
        hidden={false}
        onChanged={() => {}}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
        onOpenReparentPicker={() => {}}
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
        accounts={[acc]}
        liabilities={[]}
        hidden={false}
        onChanged={onChanged}
        onOpenAddAccount={() => {}}
        onOpenAddLiability={() => {}}
        onOpenReparentPicker={() => {}}
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
});
