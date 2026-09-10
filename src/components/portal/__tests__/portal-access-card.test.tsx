// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

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
  vi.stubGlobal("prompt", () => "DELETE");
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

  it("turns the account actions off — but not Remove access — when Clerk is unreachable", () => {
    renderActive(null);
    expect(
      screen.getByRole("button", { name: "Send sign-in link" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Sign out everywhere" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Remove portal access" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});

function renderCard(props: Partial<ComponentProps<typeof PortalAccessCard>> = {}) {
  return render(
    <PortalAccessCard
      clientId="c1"
      status="not_invited"
      primaryEmail="jane@example.com"
      invitedAt={null}
      clerkUserId={null}
      account={null}
      {...props}
    />,
  );
}

describe("PortalAccessCard — removing access vs deleting the login", () => {
  it("asks the server to REVOKE, and never touches the Clerk account", async () => {
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Remove portal access" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/disable",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "revoke" }),
      }),
    );
  });

  it("does nothing when the advisor cancels the remove-access confirmation", async () => {
    vi.stubGlobal("confirm", () => false);
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Remove portal access" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("promises the everyday action leaves their other firms alone", async () => {
    let asked = "";
    vi.stubGlobal("confirm", (message: string) => {
      asked = message;
      return true;
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Remove portal access" }));

    expect(asked).toMatch(/any other firm/i);
  });

  it("refuses to delete the login until the advisor types DELETE exactly", async () => {
    vi.stubGlobal("prompt", () => "delete");
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Delete login" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the advisor dismisses the delete prompt", async () => {
    vi.stubGlobal("prompt", () => null);
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Delete login" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the destructive mode once DELETE is typed", async () => {
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Delete login" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/disable",
      expect.objectContaining({ body: JSON.stringify({ mode: "delete_login" }) }),
    );
  });

  // The route answers `{ok:true, ended:false}` when there was no live binding to
  // end. `res.ok` alone reads that as success, the card refreshes, and the pill
  // still says Active — a dead button with no error on it.
  it("says so when the removal changed nothing, rather than reading as success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mode: "revoke", ended: false }),
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Remove portal access" }));

    const msg = await screen.findByText(/nothing was removed/i);
    expect(msg.className).toContain("text-crit");
  });

  it("stays quiet when the removal actually ended a binding", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mode: "revoke", ended: true }),
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Remove portal access" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/nothing was removed/i)).toBeNull();
  });

  it("says out loud that deleting the login reaches every firm", async () => {
    let asked = "";
    vi.stubGlobal("prompt", (message: string) => {
      asked = message;
      return "DELETE";
    });
    renderActive();

    await userEvent.click(screen.getByRole("button", { name: "Delete login" }));

    expect(asked).toMatch(/EVERY firm/);
  });
});

describe("PortalAccessCard — a request the client has not answered", () => {
  it("stops claiming the client was never invited", () => {
    renderCard({ status: "requested", requestedAt: new Date("2026-09-01T12:00:00Z") });

    expect(screen.queryByText("Not invited")).toBeNull();
    expect(screen.getByText(/Access request sent/i)).toBeDefined();
  });

  it("does not offer a Send invite button that would only 409", () => {
    renderCard({ status: "requested", requestedAt: new Date("2026-09-01T12:00:00Z") });

    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
  });

  // A mistyped address gets the firm's name, the advisor's name AND the
  // household's name on its accept screen, and accepting hands over the plan
  // and the documents. Until now this view had no buttons at all.
  it("lets the advisor withdraw the request", async () => {
    renderCard({
      status: "requested",
      requestedAt: new Date("2026-09-01T12:00:00Z"),
      requestBindingId: "b1",
    });

    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/request",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ bindingId: "b1" }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("asks first — cancelling is what the recipient's link stops working on", async () => {
    vi.stubGlobal("confirm", () => false);
    renderCard({ status: "requested", requestBindingId: "b1" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason rather than claiming the request was withdrawn", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That request is no longer pending." }),
    });
    renderCard({ status: "requested", requestBindingId: "b1" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    await waitFor(() => expect(screen.getByText(/no longer pending/i)).toBeDefined());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no cancel button when the request's id is unknown", async () => {
    // Nothing to address the DELETE to — a button that could only 400.
    renderCard({ status: "requested", requestBindingId: null });

    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
  });

  it("tells the advisor a request went out instead of an invitation — as a notice, not an error", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mode: "requested" }),
    });
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));

    const msg = await screen.findByText(/access request/i);
    expect(msg.className).toContain("text-good");
    expect(msg.className).not.toContain("text-crit");
  });

  it("stays quiet on an ordinary invitation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mode: "invited", invitationId: "inv_1" }),
    });
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/access request/i)).toBeNull();
  });
});

describe("PortalAccessCard — the client disconnected themselves", () => {
  const LEFT = new Date("2026-08-20T12:00:00Z");

  it("says who ended it and when, rather than 'Not invited'", () => {
    renderCard({ status: "not_invited", disconnectedAt: LEFT });

    expect(screen.getByText(/Disconnected by the client on \w+ \d+, 2026/)).toBeDefined();
  });

  it("offers a new request rather than an invitation — they already have a login", async () => {
    renderCard({ status: "not_invited", disconnectedAt: LEFT });

    await userEvent.click(screen.getByRole("button", { name: "Send a new request" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/portal/invite",
      expect.objectContaining({ body: JSON.stringify({ email: "jane@example.com" }) }),
    );
  });

  it("an invitation sent AFTER the disconnect wins — the advisor already acted", () => {
    renderCard({
      status: "invited",
      invitedAt: new Date("2026-09-01T12:00:00Z"),
      disconnectedAt: LEFT,
    });

    expect(screen.getByText(/Invitation sent/)).toBeDefined();
    expect(screen.queryByText(/Disconnected by the client/)).toBeNull();
  });

  it("an invitation that predates the disconnect does not outlive it", () => {
    renderCard({
      status: "invited",
      invitedAt: new Date("2026-07-01T12:00:00Z"),
      disconnectedAt: LEFT,
    });

    expect(screen.getByText(/Disconnected by the client/)).toBeDefined();
    expect(screen.queryByText(/Awaiting sign-up/)).toBeNull();
  });

  it("a live login wins over an old disconnect — the active controls still render", () => {
    renderCard({
      status: "active",
      clerkUserId: CLERK_ID,
      account: ACCOUNT,
      disconnectedAt: LEFT,
    });

    expect(screen.getByRole("button", { name: "Remove portal access" })).toBeDefined();
    expect(screen.queryByText(/Disconnected by the client/)).toBeNull();
  });
});
