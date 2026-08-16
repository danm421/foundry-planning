// @vitest-environment jsdom
//
// G5 / F14 + F19, grants half — `grants-tab.tsx` POSTs/PUTs/DELETEs straight to
// `/stock-option-accounts/<id>/grants`, which resolves the BASE-case scenario
// server-side. There is no grant targetKind for the scenario writer, so a
// what-if grant edit permanently rewrote the base plan with no Changes-panel
// row and no undo. The list stays readable in a scenario; the writes do not.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import GrantsTab from "../grants-tab";

const GRANT_ROW = {
  id: "grant-1",
  grantNumber: "RSU-1",
  grantType: "rsu",
  grantDate: "2025-01-01",
  sharesGranted: "10000",
  has83bElection: false,
  fmvAtGrant: null,
  strikePrice: null,
  strikeDiscountPct: null,
  expirationDate: null,
  notes: null,
  tranches: [
    { id: "t-1", vestDate: "2028-01-01", shares: "10000", sharesExercised: "0", sharesSold: "0" },
  ],
  plannedEvents: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

function writeCalls() {
  return fetchMock.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
    }))
    .filter((c) => c.method !== "GET");
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ grants: [GRANT_ROW] }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GrantsTab — scenario active (F14/F19)", () => {
  it("offers no way to add, edit or remove a grant", async () => {
    render(<GrantsTab clientId="client-123" accountId="acct-so" scenarioActive />);
    await waitFor(() => expect(screen.getByText(/RSU-1/)).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /add grant/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove$/ })).toBeNull();
    // The read is fine — only the writes are blocked.
    expect(writeCalls()).toEqual([]);
  });

  it("blocks a save from an editor that was already open when the scenario was switched on", async () => {
    // The chip row lives in the client layout, so clicking a scenario chip
    // re-renders GrantsTab with new searchParams WITHOUT unmounting it — an
    // editor opened a moment earlier is still on screen with a live Save Grant
    // button. Hiding the entry points is not enough; the handler has to refuse.
    const { rerender } = render(
      <GrantsTab clientId="client-123" accountId="acct-so" scenarioActive={false} />,
    );
    await waitFor(() => expect(screen.getByText(/RSU-1/)).toBeInTheDocument());

    // Open the EDIT editor on the existing grant, not Add — it comes
    // pre-filled with a valid date and share count, so "Save Grant" is
    // genuinely enabled. (An empty Add editor fails client validation and its
    // button is disabled, which would make this test pass vacuously.)
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    const saveBtn = screen.getByRole("button", { name: /save grant/i });
    expect(saveBtn).toBeEnabled();

    rerender(
      <GrantsTab clientId="client-123" accountId="acct-so" scenarioActive />,
    );
    fetchMock.mockClear();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(writeCalls()).toEqual([]);
  });

  it("says why", async () => {
    render(<GrantsTab clientId="client-123" accountId="acct-so" scenarioActive />);
    await waitFor(() => expect(screen.getByText(/RSU-1/)).toBeInTheDocument());
    expect(
      screen.getByText(/Grants are edited on the base plan/i),
    ).toBeInTheDocument();
  });
});

describe("GrantsTab — no scenario active", () => {
  it("still offers add / edit / remove", async () => {
    render(
      <GrantsTab clientId="client-123" accountId="acct-so" scenarioActive={false} />,
    );
    await waitFor(() => expect(screen.getByText(/RSU-1/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /add grant/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Remove$/ })).toBeInTheDocument();
  });
});
