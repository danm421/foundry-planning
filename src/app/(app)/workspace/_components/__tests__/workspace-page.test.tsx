// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspacePage } from "../workspace-page";

let mockSearch = "";
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function respond(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const WEEK = {
  timeZone: "Eastern Standard Time",
  events: [
    {
      id: "review",
      subject: "Annual review",
      start: "2026-10-27T10:00",
      end: "2026-10-27T11:30",
      isAllDay: false,
      isOrganizer: true,
      isCancelled: false,
      type: "singleInstance",
      attendees: [],
      teamsUrl: null,
      webLink: "https://outlook.office.com/calendar/item/review",
      editable: true,
      household: { householdId: "hh-1", householdName: "Hartley" },
    },
    {
      id: "golf",
      subject: "Saturday golf",
      start: "2026-10-31T09:00",
      end: "2026-10-31T12:00",
      isAllDay: false,
      isOrganizer: true,
      isCancelled: false,
      type: "singleInstance",
      attendees: [],
      teamsUrl: null,
      webLink: "https://outlook.office.com/calendar/item/golf",
      editable: true,
      household: null,
    },
  ],
};

const fetchMock = vi.fn<(url: string) => Promise<FakeResponse>>();

function renderPage(paneState: Parameters<typeof WorkspacePage>[0]["paneState"] = "ready") {
  return render(<WorkspacePage paneState={paneState} isAdmin={false} initialWeek="2026-10-26" />);
}

const grid = () => screen.queryByRole("region", { name: "Week calendar" });

beforeEach(() => {
  mockSearch = "";
  replaceMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respond(200, WEEK));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkspacePage — connect banner", () => {
  it("names an account already in use, then clears the query", async () => {
    mockSearch = "error=account_in_use";
    renderPage();
    expect(
      screen.getByText("That Microsoft account is already connected to another Foundry user."),
    ).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
  });

  it("confirms a fresh connection", async () => {
    mockSearch = "connected=1";
    renderPage();
    expect(screen.getByText("Microsoft 365 connected.")).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
  });

  it.each([
    ["wrong_tenant", "Sign in with your work account at your firm."],
    ["connect_declined", "Microsoft sign-in was cancelled."],
    ["connect_failed", "Couldn't connect to Microsoft. Try again."],
  ])("error=%s reads %j", (code, copy) => {
    mockSearch = `error=${code}`;
    renderPage();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it("shows no banner for member_off — the pane already says it", async () => {
    mockSearch = "error=member_off";
    renderPage("member_off");
    expect(screen.getByText("Ask your firm's admin to turn on Microsoft 365 for you.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
  });

  it("leaves a clean URL alone", () => {
    renderPage();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("WorkspacePage — the week", () => {
  it("fetches the shown Monday and renders its meetings", async () => {
    renderPage();
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace/events?start=2026-10-26",
      expect.anything(),
    );
    expect(screen.getByText("Oct 26 – Oct 30, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeEnabled();
  });

  it("Next fetches the following week", async () => {
    renderPage();
    await screen.findByText("Annual review");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByText("Nov 2 – Nov 6, 2026")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/workspace/events?start=2026-11-02",
        expect.anything(),
      ),
    );
  });

  it("does not fetch, and disables New event, before the advisor connects", () => {
    renderPage("connect");
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(grid()).toBeNull();
  });

  it("an expired sign-in (409 needs_reconnect) shows Reconnect, never an empty week", async () => {
    fetchMock.mockResolvedValue(respond(409, { error: "needs_reconnect" }));
    renderPage();
    expect(await screen.findByText("Your Microsoft sign-in expired.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/api/workspace/microsoft/connect",
    );
    expect(grid()).toBeNull();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
  });

  it("a 409 naming another pane state shows that pane", async () => {
    fetchMock.mockResolvedValue(respond(409, { error: "member_off" }));
    renderPage();
    expect(
      await screen.findByText("Ask your firm's admin to turn on Microsoft 365 for you."),
    ).toBeInTheDocument();
    expect(grid()).toBeNull();
  });

  it("Microsoft throttling (503) shows the busy pane, never an empty week, and Retry re-fetches", async () => {
    fetchMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    renderPage();
    expect(
      await screen.findByText("Microsoft is busy right now — try again in a minute."),
    ).toBeInTheDocument();
    expect(grid()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a 500", () => Promise.resolve(respond(500, { error: "Internal server error" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an unknown 409", () => Promise.resolve(respond(409, { error: "something_new" }))],
  ])("%s shows the busy pane, not an empty week", async (_label, impl) => {
    fetchMock.mockImplementation(impl);
    renderPage();
    expect(
      await screen.findByText("Microsoft is busy right now — try again in a minute."),
    ).toBeInTheDocument();
    expect(grid()).toBeNull();
  });
});

describe("WorkspacePage — weekends", () => {
  const dayHeaders = () => screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);

  it("hides weekends by default and remembers turning them on", async () => {
    renderPage();
    await screen.findByText("Annual review");
    expect(dayHeaders()).toHaveLength(5);
    expect(screen.queryByText("Saturday golf")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Show weekends" }));
    expect(dayHeaders()).toHaveLength(7);
    expect(screen.getByText("Saturday golf")).toBeInTheDocument();
    expect(screen.getByText("Oct 26 – Nov 1, 2026")).toBeInTheDocument();
    expect(localStorage.getItem("workspace.showWeekends")).toBe("true");
  });

  it("reads a remembered choice", async () => {
    localStorage.setItem("workspace.showWeekends", "true");
    renderPage();
    await screen.findByText("Annual review");
    expect(dayHeaders()).toHaveLength(7);
  });

  it("still renders when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage();
    await screen.findByText("Annual review");
    expect(dayHeaders()).toHaveLength(5);
    fireEvent.click(screen.getByRole("switch", { name: "Show weekends" }));
    expect(dayHeaders()).toHaveLength(7);
  });
});
