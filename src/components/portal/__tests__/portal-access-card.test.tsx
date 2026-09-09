// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import PortalAccessCard, {
  type PortalAccountView,
} from "../portal-access-card";

const CLERK_ID = "user_3J5uf2fehDnIbmTtbZkeD24bUgI";

const ACCOUNT: PortalAccountView = {
  name: "Jane Whitfield",
  email: "jane@example.com",
  lastSignInAt: new Date("2026-09-08T14:05:00Z"),
  twoFactorEnabled: false,
  locked: false,
};

function renderActive(overrides: Partial<PortalAccountView> | null = {}) {
  return render(
    <PortalAccessCard
      clientId="c1"
      status="active"
      primaryEmail="jane@example.com"
      invitedAt={new Date("2026-09-01T00:00:00Z")}
      clerkUserId={CLERK_ID}
      account={overrides === null ? null : { ...ACCOUNT, ...overrides }}
      fallbackName="Jane From CRM"
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PortalAccessCard — active login", () => {
  it("names the portal user instead of printing the Clerk id", () => {
    renderActive();
    expect(screen.getByText("Jane Whitfield")).toBeDefined();
    expect(screen.getByText("jane@example.com")).toBeDefined();
    // The id is the thing the advisor must never have to read off the screen.
    expect(screen.queryByText(CLERK_ID)).toBeNull();
  });

  it("keeps the Clerk id reachable as a tooltip for support", () => {
    renderActive();
    expect(screen.getByText("Jane Whitfield").getAttribute("title")).toBe(CLERK_ID);
  });

  it("falls back to the household contact when the client signed up without a name", () => {
    renderActive({ name: null });
    expect(screen.getByText("Jane From CRM")).toBeDefined();
    expect(screen.queryByText(CLERK_ID)).toBeNull();
  });

  it("says Never when the client has an account but has not signed in", () => {
    renderActive({ lastSignInAt: null });
    expect(screen.getByText("Never")).toBeDefined();
  });

  it("offers the two-factor reset only when two-factor is actually on", () => {
    const { unmount } = renderActive({ twoFactorEnabled: false });
    expect(screen.queryByRole("button", { name: "Reset two-factor" })).toBeNull();
    unmount();

    renderActive({ twoFactorEnabled: true });
    expect(screen.getByRole("button", { name: "Reset two-factor" })).toBeDefined();
  });

  it("flags a locked account and points at the way out", () => {
    renderActive({ locked: true });
    expect(screen.getByText(/Locked after repeated failed sign-ins/i)).toBeDefined();
  });
});

describe("PortalAccessCard — account actions", () => {
  it("sends a sign-in link and names the address it went to", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, email: "jane@example.com" }),
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/account",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "send_signin_link" }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Sign-in link sent to jane@example.com/i)).toBeDefined(),
    );
  });

  it("surfaces the server's reason rather than claiming the link went out", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Email is not configured for this environment" }),
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));

    await waitFor(() =>
      expect(screen.getByText(/Email is not configured/i)).toBeDefined(),
    );
    expect(screen.queryByText(/Sign-in link sent/i)).toBeNull();
  });

  it("reports how many sessions the sign-out actually ended", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, revoked: 3 }) });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/account",
      expect.objectContaining({ body: JSON.stringify({ action: "sign_out_all" }) }),
    );
    await waitFor(() => expect(screen.getByText(/Signed out of 3 sessions/i)).toBeDefined());
  });

  it("does not sign out when the advisor cancels the confirmation", async () => {
    vi.stubGlobal("confirm", () => false);
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns the account actions off — but not Disable — when Clerk is unreachable", () => {
    renderActive(null);
    expect(
      screen.getByRole("button", { name: "Send sign-in link" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Sign out everywhere" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Disable portal access" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
