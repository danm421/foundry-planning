// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const usePlaidLink = vi.fn();
vi.mock("react-plaid-link", () => ({
  usePlaidLink: (...a: unknown[]) => usePlaidLink(...a),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  usePlaidLink.mockReset();
  refresh.mockReset();
  vi.spyOn(global, "fetch").mockImplementation((url) => {
    if (String(url).endsWith("/link-token")) {
      return Promise.resolve(
        new Response(JSON.stringify({ linkToken: "link-x" }), { status: 200 }),
      );
    }
    if (String(url).endsWith("/reauth-complete")) {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
});

describe("PlaidLinkButton", () => {
  // A new link is triggered by the "Add Account" menu, which has already asked
  // which kind it is — so link mode draws nothing and mints on mount.
  it("mints a link token and opens Plaid Link on mount in 'link' mode", async () => {
    const open = vi.fn();
    usePlaidLink.mockReturnValue({ open, ready: true });

    const { PlaidLinkButton } = await import("../plaid-link-button");
    const { container } = render(
      <PlaidLinkButton mode="link" scope="banking" onLinkSuccess={vi.fn()} />,
    );
    // No button of its own — mounting IS the trigger.
    expect(container.querySelector("button")).toBeNull();
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/link-token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // The scope decides which Plaid product the token requires; dropping it on the
  // floor would silently send every client down the banking path.
  it.each(["banking", "investments"] as const)("sends scope=%s on mount", async (scope) => {
    const open = vi.fn();
    usePlaidLink.mockReturnValue({ open, ready: true });

    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(<PlaidLinkButton mode="link" scope={scope} onLinkSuccess={vi.fn()} />);
    await waitFor(() => expect(open).toHaveBeenCalled());
    // The fetch spy accumulates across tests in this file — take the most
    // recent link-token call, not the first.
    const init = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).endsWith("/link-token"))
      .at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ scope });
  });

  // Backing out has to reach the caller, which is what lets the Accounts page
  // forget the flow and let the client retry it.
  it("reports an exit to its caller in 'link' mode", async () => {
    const onExit = vi.fn();
    usePlaidLink.mockImplementation((cfg: { onExit: () => void }) => ({
      open: () => cfg.onExit(),
      ready: true,
    }));

    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(
      <PlaidLinkButton mode="link" scope="banking" onLinkSuccess={vi.fn()} onExit={onExit} />,
    );
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it("posts reauth-complete and refreshes in 'reauth' mode after Link success", async () => {
    // Simulate usePlaidLink immediately invoking onSuccess on open()
    usePlaidLink.mockImplementation((cfg: { onSuccess: () => void }) => ({
      open: () => cfg.onSuccess(),
      ready: true,
    }));
    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(<PlaidLinkButton mode="reauth" itemId="item-1" />);
    fireEvent.click(screen.getByRole("button", { name: /re-authenticate/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/items/item-1/reauth-complete",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("account-selection mode requests the right token and fires onSelectionComplete", async () => {
    const onSelectionComplete = vi.fn();
    usePlaidLink.mockImplementation((cfg: { onSuccess: () => void }) => ({
      open: () => cfg.onSuccess(),
      ready: true,
    }));
    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(
      <PlaidLinkButton mode="account-selection" itemId="item-1" onSelectionComplete={onSelectionComplete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /find more accounts/i }));
    await waitFor(() => expect(onSelectionComplete).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/link-token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", accountSelection: true }),
      }),
    );
  });

  it("posts link-token with enableProducts=true in 'enable-products' mode", async () => {
    // Simulate usePlaidLink immediately invoking onSuccess on open()
    usePlaidLink.mockImplementation((cfg: { onSuccess: () => void }) => ({
      open: () => cfg.onSuccess(),
      ready: true,
    }));
    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(<PlaidLinkButton mode="enable-products" itemId="item-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /enable spending insights/i }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/link-token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", enableProducts: true }),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/items/item-1/sync",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/items/item-1/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
