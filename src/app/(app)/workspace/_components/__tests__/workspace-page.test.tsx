// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ToastProvider } from "@/components/toast";
import type { AccountSummary } from "@/lib/workspace/types";
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

const MS_ID = "6f1c2b9e-3d4a-4e5f-8a6b-7c8d9e0f1a2b";

const ACCOUNT: AccountSummary = {
  id: MS_ID,
  provider: "microsoft",
  email: "dana@hartwell.com",
  status: "connected",
  connectedAt: "2026-10-01T00:00:00.000Z",
};

const WEEK = {
  timeZone: "America/New_York",
  timeZoneFallback: false,
  accounts: [{ connectionId: MS_ID, error: null }],
  events: [
    {
      id: "AAMkAD/review=",
      key: `${MS_ID}:AAMkAD/review=`,
      connectionId: MS_ID,
      provider: "microsoft",
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
      key: `${MS_ID}:golf`,
      connectionId: MS_ID,
      provider: "microsoft",
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

function page(paneState: PageProps["paneState"] = "ready", accounts: AccountSummary[] = [ACCOUNT]) {
  return (
    <ToastProvider>
      <WorkspacePage
        paneState={paneState}
        accounts={paneState === "ready" ? accounts : []}
        googleEnabled
        itApprovalUrl="https://login.example/adminconsent"
        googleClientId="client-123.apps.googleusercontent.com"
        initialWeek="2026-10-26"
        userId="user_me"
        households={HOUSEHOLDS}
      />
    </ToastProvider>
  );
}

function renderPage(paneState: PageProps["paneState"] = "ready", accounts: AccountSummary[] = [ACCOUNT]) {
  return render(page(paneState, accounts));
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
  it("names a Microsoft account already in use, then clears the query", async () => {
    mockSearch = "error=account_in_use&provider=microsoft";
    renderPage();
    expect(
      screen.getByText("That Microsoft account is already connected to another Foundry user."),
    ).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
  });

  it("?error=account_in_use&provider=google shows the Google copy", () => {
    mockSearch = "error=account_in_use&provider=google";
    renderPage();
    expect(screen.getByText("That Google account is already connected to another Foundry user.")).toBeInTheDocument();
  });

  it.each([
    ["connected=google", "Google connected."],
    ["connected=microsoft", "Microsoft 365 connected."],
    ["error=too_many_accounts", "You've connected 5 addresses, the most Workspace allows. Disconnect one to add another."],
    ["error=missing_permissions", "Foundry needs both your calendar and your tasks. Connect again and leave both boxes ticked."],
    ["error=google_blocked", "Your Google administrator hasn't allowed Foundry Planning. The steps for them are under + Add account."],
    ["error=needs_admin_approval", "Your Microsoft organization needs an admin to approve Foundry Planning. The link for them is under + Add account."],
    ["error=connect_declined", "Sign-in was cancelled."],
    ["error=connect_failed", "Couldn't connect. Try again."],
    ["error=impersonating", "Connecting is turned off while you're signed in as someone else."],
  ])("%s reads %j", async (query, copy) => {
    mockSearch = query;
    renderPage();
    expect(screen.getByText(copy)).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
  });

  it.each(["error=wrong_tenant", "error=member_off", "error=firm_not_approved", "connected=1"])(
    "%s (retired) shows no banner, and still clears the query",
    async (query) => {
      mockSearch = query;
      renderPage("connect");
      expect(screen.getByText("Bring in your calendar and to-dos")).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBeNull();
      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/workspace"));
    },
  );

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
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute(
      "href",
      "/api/workspace/google/connect",
    );
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(grid()).toBeNull();
  });

  it("(Review Focus 5) an impersonation session never fetches the week and shows the hidden pane", () => {
    renderPage("impersonating");
    expect(screen.getByText("Hidden while you're signed in as someone else")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(grid()).toBeNull();
  });

  it("a 409 connect (the last address went elsewhere) shows the connect pane, never an empty week", async () => {
    fetchMock.mockResolvedValue(respond(409, { error: "connect" }));
    renderPage();
    expect(await screen.findByText("Bring in your calendar and to-dos")).toBeInTheDocument();
    expect(grid()).toBeNull();
    expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
  });

  it("a 403 impersonating shows the hidden pane, not 'couldn't load'", async () => {
    fetchMock.mockResolvedValue(respond(403, { error: "impersonating" }));
    renderPage();
    expect(await screen.findByText("Hidden while you're signed in as someone else")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your calendar.")).toBeNull();
    expect(grid()).toBeNull();
  });

  it("two accounts' meetings with the same provider id are two meetings, each moved on its own", async () => {
    const GOOGLE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const twin = {
      ...WEEK.events[0],
      key: `${GOOGLE_ID}:AAMkAD/review=`,
      connectionId: GOOGLE_ID,
      provider: "google",
      subject: "Gym",
      start: "2026-10-28T07:00",
      end: "2026-10-28T08:00",
      household: null,
    };
    serverEvents = [WEEK.events[0], twin];
    writeMock.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage("ready", [ACCOUNT, { ...ACCOUNT, id: GOOGLE_ID, provider: "google", email: "dana@gmail.com" }]);

    await user.click(await screen.findByRole("button", { name: /Gym/ }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "13:00" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("1:00 – 2:00")).toBeInTheDocument();
    // The review, same id on the other account, stays where it was.
    expect(screen.getByText("10:00 – 11:30")).toBeInTheDocument();
  });

  // (R24) Only throttling reads "busy": a failure a retry may not fix points to the admin.
  it.each([
    ["a 500", () => Promise.resolve(respond(500, { error: "Internal server error" }))],
    ["a 503 (the whole-pane 'busy' is retired)", () => Promise.resolve(respond(503, { error: "throttled" }))],
    ["a mailbox Microsoft can't serve (403)", () => Promise.resolve(respond(403, { error: "not_allowed" }))],
    ["a 404", () => Promise.resolve(respond(404, { error: "not_found" }))],
    ["a 400", () => Promise.resolve(respond(400, { error: "start must be a Monday (YYYY-MM-DD)" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an unknown 409", () => Promise.resolve(respond(409, { error: "something_new" }))],
    ["a 409 naming a retired pane", () => Promise.resolve(respond(409, { error: "member_off" }))],
    ["a 200 without its time zone", () => Promise.resolve(respond(200, { events: [] }))],
  ])("%s says it couldn't load the calendar, not 'busy', never an empty week", async (_label, impl) => {
    fetchMock.mockImplementationOnce(impl);
    renderPage();
    expect(await screen.findByText("Couldn't load your calendar.")).toBeInTheDocument();
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
    events: [
      {
        ...WEEK.events[0],
        id: "nov",
        key: `${MS_ID}:nov`,
        subject: "November check-in",
        start: "2026-11-03T09:00",
        end: "2026-11-03T09:30",
      },
    ],
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
  const DISCONNECT_URL = `/api/workspace/accounts/${MS_ID}/disconnect`;

  it("names the one connected account under the calendar", async () => {
    renderPage();
    await screen.findByText("Annual review");
    expect(screen.getByText(/Connected as/)).toHaveTextContent("Connected as dana@hartwell.com");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it.each(["connect", "impersonating"] as const)("isn't offered in the %s state", (state) => {
    renderPage(state);
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it("with two accounts it's each chip's menu, and disconnects that account only", async () => {
    const OTHER = "second-id";
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const user = userEvent.setup();
    renderPage("ready", [ACCOUNT, { ...ACCOUNT, id: OTHER, email: "dana@other.com" }]);
    await screen.findByText("Annual review");
    expect(screen.queryByText(/Connected as/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "other" }));
    await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Disconnect dana@other.com?" })).getByRole("button", { name: "Disconnect" }),
    );
    expect(writeMock.mock.calls[0][0]).toBe(`/api/workspace/accounts/${OTHER}/disconnect`);
  });

  it("asks first, then drops the connection and refreshes the page", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Annual review");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect dana@hartwell.com?" });
    expect(writeMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Its calendar and to-dos leave Workspace. You can connect it again any time.")).toBeInTheDocument();

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
    renderPage();
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
    const view = renderPage();
    await screen.findByText("Annual review");
    expect(todoPanelMounts).toHaveBeenCalledTimes(1);
    view.rerender(page("connect"));
    expect(screen.queryByText(/Connected as/)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toBeInTheDocument();
    expect(todoPanelMounts).toHaveBeenCalledTimes(2);
  });

  it("a failed disconnect says so and leaves the connection", async () => {
    writeMock.mockResolvedValueOnce(respond(500, { error: "Internal server error" }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Annual review");
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Couldn't disconnect dana@hartwell.com. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("WorkspacePage — accounts", () => {
  const G = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const GOOGLE: AccountSummary = { ...ACCOUNT, id: G, provider: "google", email: "dana@gmail.com" };
  const gym = {
    ...WEEK.events[0],
    id: "gym",
    key: `${G}:gym`,
    connectionId: G,
    provider: "google",
    subject: "Gym",
    start: "2026-10-28T07:00",
    end: "2026-10-28T08:00",
    household: null,
  };
  const mixed = (googleError: string | null, msError: string | null = null) =>
    respond(200, {
      ...WEEK,
      events: googleError ? [WEEK.events[0]] : [WEEK.events[0], gym],
      accounts: [
        { connectionId: MS_ID, error: msError },
        { connectionId: G, error: googleError },
      ],
    });

  it("(Review Focus 1) a mixed week shows both accounts' meetings and the broken one's banner", async () => {
    readQueue.push(
      Promise.resolve(
        respond(200, {
          ...WEEK,
          events: [WEEK.events[0], gym],
          accounts: [
            { connectionId: MS_ID, error: null },
            { connectionId: G, error: "needs_reconnect" },
          ],
        }),
      ),
    );
    renderPage("ready", [ACCOUNT, GOOGLE]);
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
    expect(screen.getByText("Gym")).toBeInTheDocument();
    expect(screen.getByText("dana@gmail.com needs to reconnect.")).toBeInTheDocument();
  });

  it.each([
    ["needs_reconnect", "dana@hartwell.com needs to reconnect."],
    ["unavailable", "Couldn't load dana@hartwell.com's meetings."],
  ])("a sole account answering %s shows its banner, not just an empty grid", async (error, copy) => {
    readQueue.push(
      Promise.resolve(
        respond(200, { ...WEEK, events: [], accounts: [{ connectionId: MS_ID, error }] }),
      ),
    );
    renderPage();
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it("hiding an account removes its events and persists the choice", async () => {
    const user = userEvent.setup();
    readQueue.push(Promise.resolve(mixed(null)));
    renderPage("ready", [ACCOUNT, GOOGLE]);
    expect(await screen.findByText("Gym")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "gmail" }));
    await user.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(screen.queryByText("Gym")).toBeNull();
    expect(screen.getByText("Annual review")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("workspace.hiddenAccounts")!)).toEqual([G]);
  });

  it("reads hidden accounts after mount, and a hidden account's banner is not shown", async () => {
    localStorage.setItem("workspace.hiddenAccounts", JSON.stringify([G]));
    readQueue.push(Promise.resolve(mixed("unavailable")));
    renderPage("ready", [ACCOUNT, GOOGLE]);
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load dana@gmail.com's meetings.")).toBeNull();
  });

  it("a sole account stored as hidden still shows its meetings and its banner", async () => {
    localStorage.setItem("workspace.hiddenAccounts", JSON.stringify([MS_ID]));
    readQueue.push(
      Promise.resolve(
        respond(200, { ...WEEK, accounts: [{ connectionId: MS_ID, error: "needs_reconnect" }] }),
      ),
    );
    renderPage();
    expect(await screen.findByText("Annual review")).toBeInTheDocument();
    expect(screen.getByText("dana@hartwell.com needs to reconnect.")).toBeInTheDocument();
  });

  it("labels each block with its account from two accounts on, and not for one", async () => {
    readQueue.push(Promise.resolve(mixed(null)));
    const view = renderPage("ready", [ACCOUNT, GOOGLE]);
    await screen.findByText("Gym");
    expect(grid()!).toHaveTextContent("gmail");
    view.unmount();
    renderPage();
    await screen.findByText("Annual review");
    expect(grid()!).not.toHaveTextContent("hartwell");
  });

  it("still renders when storage throws on the hidden list", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    readQueue.push(Promise.resolve(mixed(null)));
    renderPage("ready", [ACCOUNT, GOOGLE]);
    await screen.findByText("Gym");
    await user.click(screen.getByRole("button", { name: "gmail" }));
    await user.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(screen.queryByText("Gym")).toBeNull();
  });
});

describe("WorkspacePage — time zone line", () => {
  it("reads Times in Central Time for America/Chicago", async () => {
    readQueue.push(Promise.resolve(respond(200, { ...WEEK, timeZone: "America/Chicago" })));
    renderPage();
    expect(await screen.findByText("Times in Central Time")).toBeInTheDocument();
  });

  it.each([
    ["no account reports one", { timeZone: "UTC", timeZoneFallback: true }],
    ["the zone is invalid", { timeZone: "Not/AZone", timeZoneFallback: false }],
  ])("falls back to the UTC line when %s", async (_l, over) => {
    readQueue.push(Promise.resolve(respond(200, { ...WEEK, ...over })));
    renderPage();
    expect(
      await screen.findByText("Times in UTC — none of your accounts reports a time zone."),
    ).toBeInTheDocument();
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
  it.each(["connect", "impersonating", "ready"] as const)(
    "mounts beside the %s calendar pane, with the advisor and their households",
    (paneState) => {
      renderPage(paneState);
      expect(screen.getByRole("complementary", { name: "To-dos" })).toBeInTheDocument();
      expect(todoPanelProps).toHaveBeenLastCalledWith({ userId: "user_me", households: HOUSEHOLDS });
    },
  );

  it("stays beside the can't-load pane when the week fails", async () => {
    fetchMock.mockResolvedValue(respond(500, { error: "Internal server error" }));
    renderPage();
    expect(await screen.findByText("Couldn't load your calendar.")).toBeInTheDocument();
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
          key: `${MS_ID}:nov`,
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
    expect(url).toBe(`/api/workspace/accounts/${MS_ID}/events/AAMkAD%2Freview%3D`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      start: "2026-10-27T13:00",
      end: "2026-10-27T14:30",
      timeZone: "America/New_York",
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

  it("a write answering 409 needs_reconnect re-reads the week: the other account stays, the broken one gets its banner", async () => {
    const G = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const gym = {
      ...WEEK.events[0],
      id: "gym",
      key: `${G}:gym`,
      connectionId: G,
      provider: "google",
      subject: "Gym",
      start: "2026-10-28T07:00",
      end: "2026-10-28T08:00",
      household: null,
    };
    const google: AccountSummary = { ...ACCOUNT, id: G, provider: "google", email: "dana@gmail.com" };
    writeMock.mockResolvedValueOnce(respond(409, { error: "needs_reconnect" }));
    // The re-read after the write: Outlook now needs reconnecting, Google still works.
    readQueue.push(Promise.resolve(respond(200, {
      ...WEEK,
      events: [gym],
      accounts: [
        { connectionId: MS_ID, error: "needs_reconnect" },
        { connectionId: G, error: null },
      ],
    })));
    readQueue.unshift(Promise.resolve(respond(200, {
      ...WEEK,
      events: [WEEK.events[0], gym],
      accounts: [
        { connectionId: MS_ID, error: null },
        { connectionId: G, error: null },
      ],
    })));
    renderPage("ready", [ACCOUNT, google]);
    await moveReviewTo("13:00");
    expect(await screen.findByText("dana@hartwell.com needs to reconnect.")).toBeInTheDocument();
    expect(screen.getByText("Gym")).toBeInTheDocument();
    expect(grid()).not.toBeNull();
    expect(screen.queryByText("Your sign-in expired.")).toBeNull();
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
    writeMock.mockResolvedValueOnce(respond(201, { event: { id: "new" }, videoFailed: false }));
    await createCall();
    const [url, init] = writeMock.mock.calls[0];
    expect(url).toBe(`/api/workspace/accounts/${MS_ID}/events`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      subject: "Intro call",
      start: "2026-10-29T15:00",
      end: "2026-10-29T15:30",
      attendees: [],
      video: true,
      timeZone: "America/New_York",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    expect(weekReads()[1][0]).toBe("/api/workspace/events?start=2026-10-26");
  });

  it("says so when the meeting saved without its Teams link", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { event: { id: "new" }, videoFailed: true }));
    await createCall();
    expect(
      await screen.findByText(
        "Meeting saved without a Teams link — your Microsoft account can't create Teams meetings.",
      ),
    ).toBeInTheDocument();
  });

  describe("on a Google account", () => {
    const G = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const google: AccountSummary = { ...ACCOUNT, id: G, provider: "google", email: "dana@gmail.com" };
    const twoWeek = () =>
      respond(200, {
        ...WEEK,
        accounts: [
          { connectionId: MS_ID, error: null },
          { connectionId: G, error: null },
        ],
      });

    async function createOnGoogle() {
      readQueue.push(Promise.resolve(twoWeek()));
      const user = userEvent.setup();
      renderPage("ready", [ACCOUNT, google]);
      await screen.findByText("Annual review");
      await user.click(screen.getByRole("button", { name: "+ New event" }));
      const dialog = screen.getByRole("dialog", { name: "New event" });
      await user.type(within(dialog).getByLabelText("Subject"), "Intro call");
      await user.selectOptions(within(dialog).getByLabelText("Calendar"), G);
      await user.click(within(dialog).getByLabelText("Add a Google Meet link"));
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
    }

    it("posts to that account and shows the Google toast when Meet fails", async () => {
      writeMock.mockResolvedValueOnce(respond(201, { event: { id: "new" }, videoFailed: true }));
      await createOnGoogle();
      expect(writeMock.mock.calls[0][0]).toBe(`/api/workspace/accounts/${G}/events`);
      expect(
        await screen.findByText(
          "Meeting saved without a Google Meet link — Google couldn't create one for this account.",
        ),
      ).toBeInTheDocument();
    });

    it("never offers a hidden account", async () => {
      localStorage.setItem("workspace.hiddenAccounts", JSON.stringify([G]));
      const user = userEvent.setup();
      renderPage("ready", [ACCOUNT, google]);
      await screen.findByText("Annual review");
      await user.click(screen.getByRole("button", { name: "+ New event" }));
      expect(screen.queryByLabelText("Calendar")).toBeNull();
      expect(screen.getByLabelText("Add a Teams link")).toBeInTheDocument();
    });

    it("never offers an account that needs to reconnect", async () => {
      const user = userEvent.setup();
      renderPage("ready", [ACCOUNT, { ...google, status: "needs_reconnect" }]);
      await screen.findByText("Annual review");
      await user.click(screen.getByRole("button", { name: "+ New event" }));
      expect(screen.queryByLabelText("Calendar")).toBeNull();
      expect(screen.getByLabelText("Add a Teams link")).toBeInTheDocument();
    });

    it("+ New event is disabled when every account is hidden, or the rest need to reconnect", async () => {
      localStorage.setItem("workspace.hiddenAccounts", JSON.stringify([MS_ID, G]));
      const { unmount } = renderPage("ready", [ACCOUNT, google]);
      await screen.findByText(/^Times in /);
      expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
      unmount();
      localStorage.setItem("workspace.hiddenAccounts", JSON.stringify([MS_ID]));
      renderPage("ready", [ACCOUNT, { ...google, status: "needs_reconnect" }]);
      await screen.findByText(/^Times in /);
      expect(screen.getByRole("button", { name: "+ New event" })).toBeDisabled();
    });

    it("a 409 needs_reconnect on create refreshes the page's account statuses", async () => {
      writeMock.mockResolvedValueOnce(respond(409, { error: "needs_reconnect" }));
      await createOnGoogle();
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });
  });

  it("a failed create keeps the dialog open with the reason", async () => {
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    await createCall();
    expect(await screen.findByText("Couldn't save the meeting. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New event" })).toBeInTheDocument();
  });

  it("a 409 naming a pane closes the dialog and shows that pane", async () => {
    writeMock.mockResolvedValueOnce(respond(409, { error: "connect" }));
    await createCall();
    expect(await screen.findByText("Bring in your calendar and to-dos")).toBeInTheDocument();
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
    expect(url).toBe(`/api/workspace/accounts/${MS_ID}/events/AAMkAD%2Freview%3D/cancel`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(weekReads()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText("Annual review")).toBeNull());
    expect(grid()).not.toBeNull();
  });
});
