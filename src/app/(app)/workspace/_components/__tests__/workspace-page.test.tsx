// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ToastProvider } from "@/components/toast";
import { WorkspacePage } from "../workspace-page";

let mockSearch = "";
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// The to-do panel reads its own route; todo-panel.test.tsx covers it. Here it
// only has to be there, so the week's fetch assertions see the week alone.
const todoPanelProps = vi.fn();
const todoPanelMounts = vi.fn();
vi.mock("../todo-panel", async () => {
  const { useEffect } = await import("react");
  return {
    TodoPanel: (props: unknown) => {
      todoPanelProps(props);
      useEffect(() => todoPanelMounts(), []);
      return <aside aria-label="To-dos" />;
    },
  };
});

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function respond(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const WEEK = {
  timeZone: "Eastern Standard Time",
  events: [
    {
      id: "AAMkAD/review=",
      subject: "Annual review",
      start: "2026-10-27T10:00",
      end: "2026-10-27T11:30",
      isAllDay: false,
      isOrganizer: true,
      isCancelled: false,
      type: "singleInstance",
      attendees: [],
      meetingUrl: null,
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
      meetingUrl: null,
      webLink: "https://outlook.office.com/calendar/item/golf",
      editable: true,
      household: null,
    },
  ],
};

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FakeResponse>>();
/** Every write (POST/PATCH); reads of the week answer with WEEK. */
const writeMock = vi.fn<(url: string, init: RequestInit) => Promise<FakeResponse>>();

const HOUSEHOLDS = [{ id: "hh-1", name: "Hartley" }];

type PageProps = Parameters<typeof WorkspacePage>[0];

function page(paneState: PageProps["paneState"] = "ready", connectedEmail: string | null = null) {
  return (
    <ToastProvider>
      <WorkspacePage
        paneState={paneState}
        isAdmin={false}
        initialWeek="2026-10-26"
        userId="user_me"
        households={HOUSEHOLDS}
        connectedEmail={connectedEmail}
      />
    </ToastProvider>
  );
}

function renderPage(paneState: PageProps["paneState"] = "ready", connectedEmail: string | null = null) {
  return render(page(paneState, connectedEmail));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** What Outlook holds: reads of the week answer with it unless a test queues its own answer. */
let serverEvents: (typeof WEEK)["events"] = [];
let readQueue: Promise<FakeResponse>[] = [];
const serverWeek = () => respond(200, { ...WEEK, events: serverEvents.map((e) => ({ ...e })) });

/** A PATCH that Outlook accepted: the server now holds the new times. */
function accepted(start: string, end: string): FakeResponse {
  serverEvents = serverEvents.map((e, i) => (i === 0 ? { ...e, start, end } : e));
  return respond(200, { event: { ...serverEvents[0] } });
}

const weekReads = () =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/workspace/events?start="));

const grid = () => screen.queryByRole("region", { name: "Week calendar" });

beforeEach(() => {
  mockSearch = "";
  replaceMock.mockReset();
  refreshMock.mockReset();
  todoPanelProps.mockReset();
  todoPanelMounts.mockReset();
  fetchMock.mockReset();
  writeMock.mockReset();
  serverEvents = WEEK.events.map((e) => ({ ...e }));
  readQueue = [];
  fetchMock.mockImplementation((url, init) =>
    init?.method ? writeMock(url, init) : (readQueue.shift() ?? Promise.resolve(serverWeek())),
  );
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

  // (R24) Only throttling reads "busy": a failure a retry may not fix points to the admin.
  it.each([
    ["a 500", () => Promise.resolve(respond(500, { error: "Internal server error" }))],
    ["a mailbox Microsoft can't serve (403)", () => Promise.resolve(respond(403, { error: "not_allowed" }))],
    ["a 404", () => Promise.resolve(respond(404, { error: "not_found" }))],
    ["a 400", () => Promise.resolve(respond(400, { error: "start must be a Monday (YYYY-MM-DD)" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an unknown 409", () => Promise.resolve(respond(409, { error: "something_new" }))],
  ])("%s says it couldn't load the calendar, not 'busy', never an empty week", async (_label, impl) => {
    fetchMock.mockImplementationOnce(impl);
    renderPage();
    expect(await screen.findByText("Couldn't load your calendar from Microsoft.")).toBeInTheDocument();
    expect(screen.getByText("If this keeps happening, ask your firm's admin.")).toBeInTheDocument();
    expect(screen.queryByText(/Microsoft is busy/)).toBeNull();
    expect(grid()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
  });
});

describe("WorkspacePage — changing weeks (F9)", () => {
  const nov = {
    ...WEEK,
    events: [{ ...WEEK.events[0], id: "nov", subject: "November check-in", start: "2026-11-03T09:00", end: "2026-11-03T09:30" }],
  };

  it("keeps the calendar in place under a loading cover while the next week loads", async () => {
    renderPage();
    await screen.findByText("Annual review");
    const calendar = grid()!;
    const next = deferred<FakeResponse>();
    fetchMock.mockReturnValueOnce(next.promise);

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    // The same grid, not a swap to a smaller "Loading" box: its scroll position stays.
    expect(grid()).toBe(calendar);
    expect(calendar.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading your week…");
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();

    await act(async () => next.resolve(respond(200, nov)));
    expect(grid()).toBe(calendar);
    expect(screen.getByText("November check-in")).toBeInTheDocument();
    expect(screen.queryByText("Annual review")).toBeNull();
    expect(screen.queryByText("Loading your week…")).toBeNull();
    expect(calendar.closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the scroll position across a week change (only the first load scrolls to 7am)", async () => {
    renderPage();
    await screen.findByText("Annual review");
    const scroller = () => grid()!.firstElementChild as HTMLElement;
    expect(scroller().scrollTop).toBe(7 * 48);
    scroller().scrollTop = 700;

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await screen.findByText("Nov 2 – Nov 6, 2026");
    await waitFor(() => expect(screen.queryByText("Loading your week…")).toBeNull());
    expect(scroller().scrollTop).toBe(700);
  });

  it("the first load, with nothing to keep in place, shows the loading box", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your week…");
    expect(grid()).toBeNull();
  });
});

describe("WorkspacePage — disconnecting your Microsoft account (I5)", () => {
  const DISCONNECT_URL = "/api/workspace/microsoft/connection/disconnect";

  it("names the connected account under the calendar", async () => {
    renderPage("ready", "dana@hartwell.com");
    await screen.findByText("Annual review");
    expect(screen.getByText(/Connected as/)).toHaveTextContent("Connected as dana@hartwell.com");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it.each(["connect", "needs_reconnect", "member_off"] as const)("isn't offered in the %s state", (state) => {
    renderPage(state, null);
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it("asks first, then drops the connection and refreshes the page", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const user = userEvent.setup();
    renderPage("ready", "dana@hartwell.com");
    await screen.findByText("Annual review");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect Microsoft 365?" });
    expect(writeMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Your Outlook calendar and to-dos leave Workspace/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    const [url, init] = writeMock.mock.calls[0];
    expect(url).toBe(DISCONNECT_URL);
    expect(init.method).toBe("POST");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can't send twice while the disconnect is out", async () => {
    const answer = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(answer.promise);
    renderPage("ready", "dana@hartwell.com");
    await screen.findByText("Annual review");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(writeMock).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(respond(200, { ok: true })));
  });

  it("the refreshed page (now Connect) reads the to-dos afresh, without the Outlook half", async () => {
    const view = renderPage("ready", "dana@hartwell.com");
    await screen.findByText("Annual review");
    expect(todoPanelMounts).toHaveBeenCalledTimes(1);
    view.rerender(page("connect", null));
    expect(screen.queryByText(/Connected as/)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toBeInTheDocument();
    expect(todoPanelMounts).toHaveBeenCalledTimes(2);
  });

  it("a failed disconnect says so and leaves the connection", async () => {
    writeMock.mockResolvedValueOnce(respond(500, { error: "Internal server error" }));
    const user = userEvent.setup();
    renderPage("ready", "dana@hartwell.com");
    await screen.findByText("Annual review");
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Couldn't disconnect Microsoft 365. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("WorkspacePage — hydration (F4)", () => {
  it("hydrates without a mismatch after the password-manager guard has marked its fields", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = renderToString(page());
    document.body.appendChild(container);
    // What src/components/password-manager-guard.tsx stamps on every field
    // before a streamed segment like this one hydrates.
    container.querySelectorAll("input").forEach((field) => {
      field.setAttribute("data-1p-ignore", "");
      field.setAttribute("data-lpignore", "true");
      field.setAttribute("data-bwignore", "");
      field.setAttribute("data-form-type", "other");
      field.setAttribute("data-protonpass-ignore", "true");
      field.setAttribute("autocomplete", "off");
    });
    expect(container.querySelector('input[role="switch"]')).not.toBeNull();

    const root = await act(async () => hydrateRoot(container, page()));
    try {
      await screen.findByText("Annual review");
      expect(errors.mock.calls.flat().join("\n")).not.toMatch(/hydrat|didn't match/i);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe("WorkspacePage — the to-do panel", () => {
  it.each(["connect", "member_off", "firm_not_approved", "needs_reconnect", "ready"] as const)(
    "mounts beside the %s calendar pane, with the advisor and their households",
    (paneState) => {
      renderPage(paneState);
      expect(screen.getByRole("complementary", { name: "To-dos" })).toBeInTheDocument();
      expect(todoPanelProps).toHaveBeenLastCalledWith({ userId: "user_me", households: HOUSEHOLDS });
    },
  );

  it("stays beside the busy pane when Microsoft is throttled", async () => {
    fetchMock.mockResolvedValue(respond(503, { error: "throttled" }));
    renderPage();
    expect(
      await screen.findByText("Microsoft is busy right now — try again in a minute."),
    ).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "To-dos" })).toBeInTheDocument();
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

describe("WorkspacePage — loading guard", () => {
  it("+ New event waits for the week to load", async () => {
    const week = deferred<FakeResponse>();
    fetchMock.mockReturnValueOnce(week.promise);
    renderPage();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
    await act(async () => week.resolve(respond(200, WEEK)));
    expect(screen.getByRole("button", { name: "+ New event" })).toBeEnabled();
  });

  it("a slow answer for the week you left never replaces the week you're on", async () => {
    const weekA = deferred<FakeResponse>();
    const weekB = deferred<FakeResponse>();
    fetchMock.mockReturnValueOnce(weekA.promise).mockReturnValueOnce(weekB.promise);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));

    const nov = {
      ...WEEK,
      events: [
        {
          ...WEEK.events[0],
          id: "nov",
          subject: "November check-in",
          start: "2026-11-03T09:00",
          end: "2026-11-03T09:30",
        },
      ],
    };
    await act(async () => weekB.resolve(respond(200, nov)));
    expect(screen.getByText("November check-in")).toBeInTheDocument();

    await act(async () => weekA.resolve(respond(200, WEEK)));
    expect(screen.getByText("November check-in")).toBeInTheDocument();
    expect(screen.queryByText("Annual review")).toBeNull();
  });
});

describe("WorkspacePage — moving a meeting", () => {
  const MOVE_FAILED = "Couldn't move the meeting — it's back where it was.";

  /** Opens the review and saves it at a new start (it's 90 minutes long). */
  async function moveReviewTo(start: string) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Annual review/ }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: start } });
    await user.click(screen.getByRole("button", { name: "Save" }));
  }

  async function moveReviewTo1pm() {
    renderPage();
    await moveReviewTo("13:00");
  }

  it("moves at once, sends exactly the new times, and keeps the move", async () => {
    const patch = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(patch.promise);
    await moveReviewTo1pm();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("1:00 – 2:30")).toBeInTheDocument();
    const [url, init] = writeMock.mock.calls[0];
    expect(url).toBe("/api/workspace/events/AAMkAD%2Freview%3D");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      start: "2026-10-27T13:00",
      end: "2026-10-27T14:30",
    });

    await act(async () => patch.resolve(accepted("2026-10-27T13:00", "2026-10-27T14:30")));
    expect(screen.getByText("1:00 – 2:30")).toBeInTheDocument();
    // Then it re-reads, so the screen settles on what Outlook holds.
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    expect(screen.getByText("1:00 – 2:30")).toBeInTheDocument();
    expect(screen.queryByText(MOVE_FAILED)).toBeNull();
  });

  it("two moves in flight that both fail: one toast, and the screen settles on Outlook's time", async () => {
    const first = deferred<FakeResponse>();
    const second = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPage();
    await moveReviewTo("13:00");
    await moveReviewTo("15:00");
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();

    // The older move is superseded: its failure says and undoes nothing.
    await act(async () => first.resolve(respond(503, { error: "throttled" })));
    expect(screen.queryByText(MOVE_FAILED)).toBeNull();
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();

    await act(async () => second.resolve(respond(503, { error: "throttled" })));
    expect(screen.getAllByText(MOVE_FAILED)).toHaveLength(1);
    // Outlook never took either move: the re-read shows 10:00, not the 1:00 guess.
    await waitFor(() => expect(screen.getByText("10:00 – 11:30")).toBeInTheDocument());
    expect(screen.queryByText("1:00 – 2:30")).toBeNull();
  });

  it("a superseded move's late answer never overwrites the newer move", async () => {
    const first = deferred<FakeResponse>();
    const second = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPage();
    await moveReviewTo("13:00");
    await moveReviewTo("15:00");

    await act(async () => second.resolve(accepted("2026-10-27T15:00", "2026-10-27T16:30")));
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    await act(async () =>
      first.resolve(respond(200, { event: { ...WEEK.events[0], start: "2026-10-27T13:00", end: "2026-10-27T14:30" } })),
    );
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();
    expect(screen.queryByText("1:00 – 2:30")).toBeNull();
  });

  it("a re-read sent before a move lands never puts the old time back", async () => {
    renderPage();
    // A failed move asks for a re-read; hold that read's (pre-move) answer back.
    const staleRead = deferred<FakeResponse>();
    readQueue.push(staleRead.promise);
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    await moveReviewTo("13:00");
    await waitFor(() => expect(weekReads()).toHaveLength(2));

    const patch = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(patch.promise);
    await moveReviewTo("15:00");
    await act(async () => patch.resolve(accepted("2026-10-27T15:00", "2026-10-27T16:30")));
    await act(async () => staleRead.resolve(respond(200, WEEK)));

    await waitFor(() => expect(weekReads()).toHaveLength(3));
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();
    expect(screen.queryByText("10:00 – 11:30")).toBeNull();
  });

  it("a re-read that lands mid-move keeps the meeting where it was dragged", async () => {
    renderPage();
    const read = deferred<FakeResponse>();
    readQueue.push(read.promise);
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    await moveReviewTo("13:00"); // fails, so the week is re-read (held back)
    await waitFor(() => expect(weekReads()).toHaveLength(2));

    const patch = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(patch.promise);
    await moveReviewTo("15:00");
    await act(async () => read.resolve(serverWeek())); // Outlook still says 10:00
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();

    await act(async () => patch.resolve(accepted("2026-10-27T15:00", "2026-10-27T16:30")));
    await waitFor(() => expect(weekReads()).toHaveLength(3));
    expect(screen.getByText("3:00 – 4:30")).toBeInTheDocument();
  });

  it.each([
    [
      "someone else's meeting (403)",
      () => Promise.resolve(respond(403, { error: "not_organizer" })),
    ],
    ["Microsoft throttling (503)", () => Promise.resolve(respond(503, { error: "throttled" }))],
    ["a 500", () => Promise.resolve(respond(500, { error: "Internal server error" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("%s puts it back and says so", async (_label, impl) => {
    writeMock.mockImplementationOnce(impl);
    await moveReviewTo1pm();
    expect(await screen.findByText(MOVE_FAILED)).toBeInTheDocument();
    expect(screen.getByText("10:00 – 11:30")).toBeInTheDocument();
    expect(screen.queryByText("1:00 – 2:30")).toBeNull();
  });

  it("an expired sign-in (409 needs_reconnect) flips to Reconnect", async () => {
    writeMock.mockResolvedValueOnce(respond(409, { error: "needs_reconnect" }));
    await moveReviewTo1pm();
    expect(await screen.findByText("Your Microsoft sign-in expired.")).toBeInTheDocument();
    expect(grid()).toBeNull();
  });

  it("an unchanged save sends nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Annual review/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe("WorkspacePage — creating a meeting", () => {
  async function createCall() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Annual review");
    await user.click(screen.getByRole("button", { name: "+ New event" }));
    const dialog = screen.getByRole("dialog", { name: "New event" });
    await user.type(within(dialog).getByLabelText("Subject"), "Intro call");
    fireEvent.change(within(dialog).getByLabelText("Date"), {
      target: { value: "2026-10-29" },
    });
    fireEvent.change(within(dialog).getByLabelText("Start"), {
      target: { value: "15:00" },
    });
    await user.click(within(dialog).getByLabelText("Add a Teams link"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
  }

  it("posts exactly the schema's keys, then re-reads the week", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { event: { id: "new" }, teamsFailed: false }));
    await createCall();
    const [url, init] = writeMock.mock.calls[0];
    expect(url).toBe("/api/workspace/events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      subject: "Intro call",
      start: "2026-10-29T15:00",
      end: "2026-10-29T15:30",
      attendees: [],
      video: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    expect(weekReads()[1][0]).toBe("/api/workspace/events?start=2026-10-26");
  });

  it("says so when the meeting saved without its Teams link", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { event: { id: "new" }, teamsFailed: true }));
    await createCall();
    expect(
      await screen.findByText(
        "Meeting saved without a Teams link — your Microsoft account can't create Teams meetings.",
      ),
    ).toBeInTheDocument();
  });

  it("a failed create keeps the dialog open with the reason", async () => {
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    await createCall();
    expect(await screen.findByText("Couldn't save the meeting. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New event" })).toBeInTheDocument();
  });

  it("a 409 naming a pane closes the dialog and shows that pane", async () => {
    writeMock.mockResolvedValueOnce(respond(409, { error: "member_off" }));
    await createCall();
    expect(
      await screen.findByText("Ask your firm's admin to turn on Microsoft 365 for you."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("WorkspacePage — cancelling a meeting", () => {
  it("cancels with no body, drops the meeting, and re-reads the week", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Annual review/ }));
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    // Outlook no longer has it.
    fetchMock.mockImplementation((url, init) =>
      init?.method
        ? writeMock(url, init)
        : Promise.resolve(respond(200, { ...WEEK, events: [WEEK.events[1]] })),
    );
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));

    const [url, init] = writeMock.mock.calls[0];
    expect(url).toBe("/api/workspace/events/AAMkAD%2Freview%3D/cancel");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText("Annual review")).toBeNull());
    expect(grid()).not.toBeNull();
  });
});
