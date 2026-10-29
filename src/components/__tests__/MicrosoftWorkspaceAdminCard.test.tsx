// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MicrosoftWorkspaceAdminCard } from "../MicrosoftWorkspaceAdminCard";

const fetchMock = vi.fn();

function ok(body: unknown = { ok: true }) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MEMBERS = [
  { userId: "u_dana", displayName: "Dana Whitfield", status: "connected" as const, connectedEmail: "dana@hartwell.com", enabled: true },
  { userId: "u_marcus", displayName: "Marcus Lee", status: "not_connected" as const, connectedEmail: null, enabled: true },
  { userId: "u_priya", displayName: "Priya Raman", status: "off" as const, connectedEmail: null, enabled: false },
  { userId: "u_sam", displayName: "Sam Ortiz", status: "needs_reconnect" as const, connectedEmail: "sam@hartwell.com", enabled: true },
];
const APPROVAL = { approvedAt: "2026-10-28T15:00:00.000Z" };

describe("MicrosoftWorkspaceAdminCard — not approved", () => {
  it("offers Connect and Copy approval link, and Connect posts mode redirect", async () => {
    fetchMock.mockReturnValue(ok({ url: "about:blank#consent" }));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<MicrosoftWorkspaceAdminCard approval={null} members={[]} flash={null} />);

    expect(screen.getByRole("button", { name: "Copy approval link" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Microsoft 365" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/microsoft/admin-consent/start");
    expect(JSON.parse(init.body)).toEqual({ mode: "redirect" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("about:blank#consent"));
  });

  it("copies the approval link and says it works once", async () => {
    fetchMock.mockReturnValue(ok({ url: "https://app/consent?x=1" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MicrosoftWorkspaceAdminCard approval={null} members={[]} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy approval link" }));

    await screen.findByText("Link copied — it works once and expires in 7 days.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: "link" });
    expect(writeText).toHaveBeenCalledWith("https://app/consent?x=1");
  });

  it("shows the expired-link banner", () => {
    render(<MicrosoftWorkspaceAdminCard approval={null} members={[]} flash="consent_expired" />);
    expect(screen.getByText(/link expired or was already used/i)).toBeTruthy();
  });

  it("shows the declined banner", () => {
    render(<MicrosoftWorkspaceAdminCard approval={null} members={[]} flash="consent_declined" />);
    expect(screen.getByText(/wasn.t approved/i)).toBeTruthy();
  });
});

describe("MicrosoftWorkspaceAdminCard — approved", () => {
  it("renders the four status labels and the connected email", () => {
    render(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash="approved" />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Hasn't connected yet")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText("Needs to reconnect")).toBeTruthy();
    expect(screen.getByText("sam@hartwell.com")).toBeTruthy();
    expect(screen.getByText(/Microsoft 365 is approved/)).toBeTruthy();
  });

  it("flips a switch optimistically and posts the new value", async () => {
    fetchMock.mockReturnValue(ok());
    render(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />);
    const sw = screen.getByRole("switch", { name: /Priya Raman/ }) as HTMLInputElement;
    expect(sw.checked).toBe(false);

    fireEvent.click(sw);

    expect(sw.checked).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/microsoft/members/u_priya/access");
    expect(JSON.parse(init.body)).toEqual({ enabled: true });
  });

  it("rolls the switch back with an error on a 500", async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response("{}", { status: 500 })));
    render(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />);
    const sw = screen.getByRole("switch", { name: /Priya Raman/ }) as HTMLInputElement;

    fireEvent.click(sw);

    await waitFor(() => expect(sw.checked).toBe(false));
    expect(screen.getByRole("alert").textContent).toMatch(/Priya Raman/);
  });

  it("turns on for everyone and refreshes", async () => {
    fetchMock.mockReturnValue(ok({ enabled: 4 }));
    render(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Turn on for everyone" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/microsoft/members/access-all");
  });

  it("asks for confirmation before disconnecting, naming Entra", async () => {
    fetchMock.mockReturnValue(ok());
    render(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Microsoft 365" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Microsoft Entra → Enterprise applications/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/microsoft/disconnect");
  });

  it("follows refreshed server props after Turn on for everyone", async () => {
    fetchMock.mockReturnValue(ok({ enabled: 4 }));
    const { rerender } = render(
      <MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on for everyone" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    const refreshed = MEMBERS.map((m) =>
      m.userId === "u_priya" ? { ...m, enabled: true, status: "not_connected" as const } : m,
    );
    rerender(<MicrosoftWorkspaceAdminCard approval={APPROVAL} members={refreshed} flash={null} />);

    expect((screen.getByRole("switch", { name: /Priya Raman/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("after a successful flip, shows the refreshed status, not a stale Connected", async () => {
    fetchMock.mockReturnValue(ok());
    const { rerender } = render(
      <MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />,
    );
    const dana = () => screen.getByRole("switch", { name: /Dana Whitfield/ }) as HTMLInputElement;

    fireEvent.click(dana()); // off
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(
      <MicrosoftWorkspaceAdminCard
        approval={APPROVAL}
        members={MEMBERS.map((m) =>
          m.userId === "u_dana" ? { ...m, enabled: false, status: "off" as const, connectedEmail: null } : m,
        )}
        flash={null}
      />,
    );
    fireEvent.click(dana()); // on again
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    rerender(
      <MicrosoftWorkspaceAdminCard
        approval={APPROVAL}
        members={MEMBERS.map((m) =>
          m.userId === "u_dana"
            ? { ...m, enabled: true, status: "not_connected" as const, connectedEmail: null }
            : m,
        )}
        flash={null}
      />,
    );

    expect(dana().checked).toBe(true);
    expect(screen.queryByText("dana@hartwell.com")).toBeNull();
    expect(screen.getAllByText("Hasn't connected yet")).toHaveLength(2);
  });

  it("holds a flipped switch's new value between the response and the refreshed props", async () => {
    fetchMock.mockReturnValue(ok());
    const { rerender } = render(
      <MicrosoftWorkspaceAdminCard approval={APPROVAL} members={MEMBERS} flash={null} />,
    );
    const priya = () => screen.getByRole("switch", { name: /Priya Raman/ }) as HTMLInputElement;

    fireEvent.click(priya());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Response is in, refreshed props have not landed: still the new value.
    expect(priya().checked).toBe(true);
    const row = priya().closest("tr")?.textContent ?? "";
    expect(row).toContain("Hasn't connected yet");
    expect(row).not.toContain("Off");

    rerender(
      <MicrosoftWorkspaceAdminCard
        approval={APPROVAL}
        members={MEMBERS.map((m) =>
          m.userId === "u_priya" ? { ...m, enabled: true, status: "not_connected" as const } : m,
        )}
        flash={null}
      />,
    );
    expect(priya().checked).toBe(true);
    expect(priya().disabled).toBe(false);
  });
});
