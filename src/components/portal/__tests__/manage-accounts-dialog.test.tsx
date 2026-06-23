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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); refresh.mockClear(); portalFetch.mockReset(); });
beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  portalFetch.mockResolvedValue(new Response(JSON.stringify(listPayload), { status: 200 }));
});

describe("ManageAccountsDialog", () => {
  it("loads and shows linked + available sections", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Checking")).toBeInTheDocument());
    // "Brokerage" appears both as the account name row label and as a <option> in the type selector.
    // Assert >= 2 to confirm the available account row rendered (not just the select option).
    expect(screen.getAllByText("Brokerage").length).toBeGreaterThanOrEqual(2);
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
    await waitFor(() => expect(screen.getAllByText("Brokerage").length).toBeGreaterThanOrEqual(2));
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

  it("caps panel height, scrolls, and paints an opaque panel so content stays reachable", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Checking")).toBeInTheDocument());
    // Regression guard for the off-screen/no-scroll + transparent-panel bug.
    // The earlier build used phantom tokens (bg-surface, border-border) that
    // resolve to no CSS, so the panel was transparent and the institution row
    // bled through; with no height cap a tall list also pushed the header and
    // the "Add selected" action off-screen. jsdom can't measure layout, so
    // assert the structural classes: a height-capped, opaque panel with an
    // internal scroll region.
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/max-h-/);
    expect(dialog.className).toMatch(/bg-card/);
    expect(dialog.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("shows a sticky 'Add selected' footer with a selected count", async () => {
    const { ManageAccountsDialog } = await import("../manage-accounts-dialog");
    render(<ManageAccountsDialog itemId="item-1" institutionName="Tartan Bank" editEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /add selected/i })).toBeInTheDocument());
    // One available account (Brokerage), un-skipped → "1 of 1 selected".
    expect(screen.getByText(/1 of 1 selected/i)).toBeInTheDocument();
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
