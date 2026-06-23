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
  it("mints a link token and opens Plaid Link in 'link' mode", async () => {
    const open = vi.fn();
    usePlaidLink.mockReturnValue({ open, ready: true });

    const { PlaidLinkButton } = await import("../plaid-link-button");
    render(<PlaidLinkButton mode="link" onLinkSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /link bank/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portal/plaid/link-token",
      expect.objectContaining({ method: "POST" }),
    );
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
