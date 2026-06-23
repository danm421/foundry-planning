// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const portalFetch = vi.fn();
vi.mock("../portal-mode-context", () => ({ usePortalFetch: () => portalFetch }));
// Stub the link button so the dialog renders without react-plaid-link.
vi.mock("../plaid-link-button", () => ({
  PlaidLinkButton: () => null,
  // re-export type as a no-op for TS isolation in the test bundle
}));

const listPayload = {
  itemId: "item-1",
  institutionName: "Tartan Bank",
  linked: [
    { id: "acct-1", kind: "account", name: "Checking", value: 5000, plaidAccountId: "pa-1", mask: "1234" },
  ],
  available: [
    { plaidAccountId: "pa-2", name: "Brokerage", mask: "9012", type: "investment", subtype: "brokerage", balance: 12000 },
  ],
  existingCandidates: [],
  existingLiabilityCandidates: [],
  needsReauth: false,
};

afterEach(() => { vi.restoreAllMocks(); refresh.mockClear(); portalFetch.mockReset(); });
beforeEach(() => {
  portalFetch.mockResolvedValue(new Response(JSON.stringify(listPayload), { status: 200 }));
});

describe("ManageAccountsDialog", () => {
  it("loads and shows linked + available sections", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Checking")).toBeInTheDocument());
    // "Brokerage" appears both as the account name and as a <option> in the type selector;
    // getAllByText confirms it is present (at least once).
    expect(screen.getAllByText("Brokerage").length).toBeGreaterThan(0);
  });

  it("detach calls the detach endpoint and refetches", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Checking")).toBeInTheDocument());
    portalFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    portalFetch.mockResolvedValueOnce(new Response(JSON.stringify(listPayload), { status: 200 }));
    fireEvent.click(screen.getAllByRole("button", { name: /unlink/i })[0]);
    await waitFor(() =>
      expect(portalFetch).toHaveBeenCalledWith(
        "/api/portal/plaid/items/item-1/accounts/pa-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Add selected posts decisions to /exchange/commit", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Brokerage").length).toBeGreaterThan(0));
    portalFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, linkedAccountIds: [] }), { status: 200 }));
    portalFetch.mockResolvedValueOnce(new Response(JSON.stringify(listPayload), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: /add selected/i }));
    await waitFor(() =>
      expect(portalFetch).toHaveBeenCalledWith(
        "/api/portal/plaid/exchange/commit",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows reconnect prompt when needsReauth", async () => {
    portalFetch.mockReset().mockResolvedValue(
      new Response(JSON.stringify({ ...listPayload, needsReauth: true, available: [] }), { status: 200 }),
    );
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/reconnect|re-authenticate/i)).toBeInTheDocument());
  });
});
