// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoPanel } from "../todo-panel";

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function respond(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const FOUNDRY_TASK = {
  id: "t-1",
  title: "Prep Nguyen proposal",
  status: "open",
  priority: "high",
  dueDate: "2026-10-29",
  householdId: "hh-1",
  householdName: "Nguyen household",
  assigneeUserId: "user_me",
  recurrence: "none",
  commentCount: 0,
  fileCount: 0,
};

const OUTLOOK_TODO = {
  provider: "microsoft",
  id: "AAMk/task=",
  listId: "AAMk/list=",
  title: "Send Hartley the updated plan",
  dueDate: "2026-10-28",
  notes: "Attach the Monte Carlo page",
  notesAreHtml: false,
};

const MS_ID = "6f1c2b9e-3d4a-4e5f-8a6b-7c8d9e0f1a2b";
const GOOGLE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** One account's half of `GET /api/workspace/todos`. */
function account(todos: unknown[] | null, error: string | null = null, connectionId = MS_ID, provider = "microsoft") {
  return { connectionId, provider, todos, error };
}

/** The route's answer: Foundry tasks, each account's to-dos or error, and why accounts are hidden. */
function answer(foundry: unknown[], accounts: unknown[], blocked: string | null = null) {
  return { foundry, accounts, blocked };
}

const TODOS = answer([FOUNDRY_TASK], [account([OUTLOOK_TODO])]);

const OUTLOOK_URL = `/api/workspace/accounts/${MS_ID}/todos/AAMk%2Flist%3D/AAMk%2Ftask%3D`;
const HOUSEHOLDS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Hartley" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Nguyen" },
];

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FakeResponse>>();
/** Every write (POST/PATCH); reads of the list answer with `serverTodos`. */
const writeMock = vi.fn<(url: string, init: RequestInit) => Promise<FakeResponse>>();
let serverTodos: unknown = TODOS;

const reads = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/workspace/todos" && !init?.method);
const sent = (i = 0) => {
  const [url, init] = writeMock.mock.calls[i];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
};

function renderPanel() {
  return render(<TodoPanel userId="user_me" households={HOUSEHOLDS} />);
}

const panel = () => screen.getByRole("complementary", { name: "To-dos" });
const checkbox = (title: string) => screen.getByRole("checkbox", { name: `Mark ${title} done` });

beforeEach(() => {
  // Only the clock: "today" is Wed 2026-10-28 in the browser's zone.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 28, 9, 0));
  fetchMock.mockReset();
  writeMock.mockReset();
  serverTodos = TODOS;
  fetchMock.mockImplementation((url, init) =>
    init?.method ? writeMock(url, init) : Promise.resolve(respond(200, serverTodos)),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TodoPanel — the list", () => {
  it("shows both sources with their chips, grouped by due date, and counts what's open", async () => {
    renderPanel();
    expect(await screen.findByText("Send Hartley the updated plan")).toBeInTheDocument();
    expect(screen.getByText("Outlook")).toBeInTheDocument();
    expect(screen.getByText("Foundry")).toBeInTheDocument();
    expect(screen.getByText("Nguyen household · High")).toBeInTheDocument();

    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByText("Send Hartley the updated plan")).toBeInTheDocument();
    const thisWeek = screen.getByRole("region", { name: "This week" });
    expect(within(thisWeek).getByText("Prep Nguyen proposal")).toBeInTheDocument();
    // Empty groups are hidden.
    expect(screen.queryByRole("region", { name: "Overdue" })).toBeNull();
    expect(screen.queryByRole("region", { name: "No date" })).toBeNull();

    const count = screen.getByText("2 open");
    expect(count).toHaveClass("tabular");
    expect(within(thisWeek).getByText("Oct 29")).toHaveClass("tabular");
  });

  it("links a Foundry task to its page", async () => {
    renderPanel();
    expect(await screen.findByRole("link", { name: "Prep Nguyen proposal" })).toHaveAttribute(
      "href",
      "/tasks?task=t-1",
    );
  });

  it("says when nothing is open", async () => {
    serverTodos = answer([], [account([])]);
    renderPanel();
    expect(await screen.findByText("Nothing open.")).toBeInTheDocument();
    expect(screen.getByText("0 open")).toBeInTheDocument();
  });

  it.each([
    ["a 500", () => Promise.resolve(respond(500, { error: "Internal server error" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a malformed answer", () => Promise.resolve(respond(200, { events: [] }))],
    ["the retired phase-1 shape", () => Promise.resolve(respond(200, { foundry: [], outlook: [], outlookError: null }))],
  ])("%s shows an error with Retry, never an empty list", async (_label, impl) => {
    fetchMock.mockImplementationOnce(impl);
    renderPanel();
    expect(await screen.findByText("Couldn't load your to-dos.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing open.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Send Hartley the updated plan")).toBeInTheDocument();
    expect(reads()).toHaveLength(2);
  });
});

describe("TodoPanel — Outlook's side", () => {
  it("flattens every account's to-dos into the one list", async () => {
    const googleTodo = { ...OUTLOOK_TODO, provider: "google", id: "g-1", listId: "@default", title: "Book the Schwab call" };
    serverTodos = answer(
      [FOUNDRY_TASK],
      [account([OUTLOOK_TODO]), account([googleTodo], null, GOOGLE_ID, "google")],
    );
    renderPanel();
    expect(await screen.findByText("Send Hartley the updated plan")).toBeInTheDocument();
    expect(screen.getByText("Book the Schwab call")).toBeInTheDocument();
    expect(screen.getByText("Prep Nguyen proposal")).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();
  });

  it("(Review Focus 1) one account failing never hides another account's to-dos", async () => {
    const googleTodo = { ...OUTLOOK_TODO, provider: "google", id: "g-1", listId: "@default", title: "Book the Schwab call" };
    serverTodos = answer(
      [FOUNDRY_TASK],
      [account(null, "unavailable"), account([googleTodo], null, GOOGLE_ID, "google")],
    );
    renderPanel();
    expect(await screen.findByText("Book the Schwab call")).toBeInTheDocument();
    expect(screen.getByText("Prep Nguyen proposal")).toBeInTheDocument();
  });

  it("needs_reconnect: a one-line notice links to reconnect, and Foundry tasks still show", async () => {
    serverTodos = answer([FOUNDRY_TASK], [account(null, "needs_reconnect")]);
    renderPanel();
    const link = await screen.findByRole("link", {
      name: "Reconnect Microsoft 365 to see your Outlook to-dos.",
    });
    expect(link).toHaveAttribute("href", "/api/workspace/microsoft/connect");
    expect(screen.getByText("Prep Nguyen proposal")).toBeInTheDocument();
  });

  it("throttled: says Outlook's to-dos are unavailable", async () => {
    serverTodos = answer([FOUNDRY_TASK], [account(null, "throttled")]);
    renderPanel();
    expect(await screen.findByText("Outlook to-dos are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("Prep Nguyen proposal")).toBeInTheDocument();
  });

  it("unavailable: a failure that isn't throttling points to the admin", async () => {
    serverTodos = answer([FOUNDRY_TASK], [account(null, "unavailable")]);
    renderPanel();
    expect(
      await screen.findByText(
        "Couldn't load your Outlook to-dos from Microsoft. If this keeps happening, ask your firm's admin.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Outlook to-dos are unavailable right now.")).toBeNull();
    expect(screen.getByText("Prep Nguyen proposal")).toBeInTheDocument();
  });

  it("no connected accounts: no notice, and new to-dos can only be Foundry tasks", async () => {
    serverTodos = answer([FOUNDRY_TASK], []);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Prep Nguyen proposal");
    expect(screen.queryByText(/Outlook to-dos/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "+ Add a to-do" }));
    const toggle = screen.getByRole("switch", { name: "Make it a Foundry task" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText("Household")).toBeInTheDocument();
  });

  it("(Review Focus 5) impersonating: Foundry tasks still listed, and new to-dos can only be Foundry tasks", async () => {
    serverTodos = answer([FOUNDRY_TASK], [], "impersonating");
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText("Prep Nguyen proposal")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add a to-do" }));
    expect(screen.getByRole("switch", { name: "Make it a Foundry task" })).toBeDisabled();
  });
});

describe("TodoPanel — checking one off", () => {
  it("an Outlook to-do PATCHes its own route with completed", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Send Hartley the updated plan done" }));

    expect(sent()).toEqual({ url: OUTLOOK_URL, method: "PATCH", body: { completed: true } });
    await waitFor(() => expect(screen.queryByText("Send Hartley the updated plan")).toBeNull());
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("(M2) a repeating Outlook to-do re-reads the list, so its next occurrence shows and the done one stays gone", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    // Microsoft adds the next occurrence; this read still (briefly) lists the finished one.
    const next = { ...OUTLOOK_TODO, id: "AAMk/task-next=", dueDate: "2026-10-30" };
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Send Hartley the updated plan done" }));
    serverTodos = answer([FOUNDRY_TASK], [account([OUTLOOK_TODO, next])]);

    await waitFor(() => expect(reads()).toHaveLength(2));
    const thisWeek = await screen.findByRole("region", { name: "This week" });
    expect(within(thisWeek).getByText("Send Hartley the updated plan")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Today" })).toBeNull();
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("a Foundry task POSTs its status route with done", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { task: {}, followOnId: null }));
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Prep Nguyen proposal done" }));

    expect(sent()).toEqual({ url: "/api/crm/tasks/t-1/status", method: "POST", body: { status: "done" } });
    await waitFor(() => expect(screen.queryByText("Prep Nguyen proposal")).toBeNull());
    expect(reads()).toHaveLength(1);
  });

  it("a recurring Foundry task re-reads the list so its next one shows", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { task: {}, followOnId: "t-2" }));
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Prep Nguyen proposal done" }));
    await waitFor(() => expect(reads()).toHaveLength(2));
  });

  it("fades the row at once and ignores a second click while it's in flight", async () => {
    const answer = deferred<FakeResponse>();
    writeMock.mockReturnValueOnce(answer.promise);
    renderPanel();
    const box = await screen.findByRole("checkbox", { name: "Mark Send Hartley the updated plan done" });
    fireEvent.click(box);
    fireEvent.click(box);

    expect(box).toBeChecked();
    expect(box.closest("li")).toHaveClass("opacity-40");
    expect(screen.getByText("1 open")).toBeInTheDocument();
    expect(writeMock).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(respond(200, { ok: true })));
  });

  it.each([
    ["a 503", () => Promise.resolve(respond(503, { error: "throttled" }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("%s brings the row back with an inline error", async (_label, impl) => {
    writeMock.mockImplementationOnce(impl);
    renderPanel();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mark Send Hartley the updated plan done" }));

    expect(await screen.findByText("Couldn't mark it done. Try again.")).toBeInTheDocument();
    const box = checkbox("Send Hartley the updated plan");
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    expect(box.closest("li")).not.toHaveClass("opacity-40");
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });
});

describe("TodoPanel — adding one", () => {
  async function openAdd() {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Send Hartley the updated plan");
    await user.click(screen.getByRole("button", { name: "+ Add a to-do" }));
    return user;
  }

  it("adds an Outlook to-do with exactly the schema's keys, then re-reads the list", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { todo: {} }));
    const user = await openAdd();
    const toggle = screen.getByRole("switch", { name: "Make it a Foundry task" });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("Household")).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxLength", "255");

    await user.type(screen.getByLabelText("Title"), "  Renew E&O policy ");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-14" } });
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(sent()).toEqual({
      url: `/api/workspace/accounts/${MS_ID}/todos`,
      method: "POST",
      body: { title: "Renew E&O policy", dueDate: "2026-11-14", notes: "" },
    });
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("an Outlook to-do with no date sends null", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { todo: {} }));
    const user = await openAdd();
    await user.type(screen.getByLabelText("Title"), "Call Schwab{Enter}");
    expect(sent().body).toEqual({ title: "Call Schwab", dueDate: null, notes: "" });
  });

  it("a Foundry task goes to the CRM route, assigned to the advisor", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { task: {} }));
    const user = await openAdd();
    await user.click(screen.getByRole("switch", { name: "Make it a Foundry task" }));
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxLength", "200");

    await user.type(screen.getByLabelText("Title"), "Collect 2025 return");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-30" } });
    await user.selectOptions(screen.getByLabelText("Household"), "Nguyen");
    await user.selectOptions(screen.getByLabelText("Priority"), "High");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(sent()).toEqual({
      url: "/api/crm/tasks",
      method: "POST",
      body: {
        title: "Collect 2025 return",
        dueDate: "2026-10-30",
        priority: "high",
        householdId: HOUSEHOLDS[1].id,
        assigneeUserId: "user_me",
      },
    });
    await waitFor(() => expect(reads()).toHaveLength(2));
  });

  it("a Foundry task with no household or date sends nulls and medium priority", async () => {
    writeMock.mockResolvedValueOnce(respond(201, { task: {} }));
    const user = await openAdd();
    await user.click(screen.getByRole("switch", { name: "Make it a Foundry task" }));
    await user.type(screen.getByLabelText("Title"), "Review book");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(sent().body).toEqual({
      title: "Review book",
      dueDate: null,
      priority: "med",
      householdId: null,
      assigneeUserId: "user_me",
    });
  });

  it("a failed add keeps the row open with what was typed and says so", async () => {
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    const user = await openAdd();
    await user.type(screen.getByLabelText("Title"), "Renew E&O policy");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Couldn't add the to-do. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Renew E&O policy");
    expect(reads()).toHaveLength(1);
  });

  it("Add waits for a title", async () => {
    const user = await openAdd();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(screen.getByLabelText("Title"), "   ");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("Cancel closes the row without sending anything", async () => {
    const user = await openAdd();
    await user.type(screen.getByLabelText("Title"), "Never mind");
    await user.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe("TodoPanel — editing an Outlook to-do", () => {
  async function openEditor() {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Send Hartley the updated plan" }));
    return { user, dialog: screen.getByRole("dialog", { name: "Edit to-do" }) };
  }

  it("opens with the to-do's title, due date and notes", async () => {
    const { dialog } = await openEditor();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Send Hartley the updated plan");
    expect(within(dialog).getByLabelText("Due date")).toHaveValue("2026-10-28");
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("Attach the Monte Carlo page");
  });

  it("editing only the title PATCHes { title } — never notes — then re-reads the list", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const { user, dialog } = await openEditor();
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Send Hartley the final plan");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const call = sent();
    expect(call.url).toBe(OUTLOOK_URL);
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({ title: "Send Hartley the final plan" });
    expect("notes" in call.body).toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(reads()).toHaveLength(2));
  });

  it("sends each changed field, and a cleared date as null", async () => {
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const { user, dialog } = await openEditor();
    fireEvent.change(within(dialog).getByLabelText("Due date"), { target: { value: "" } });
    await user.type(within(dialog).getByLabelText("Notes"), " and the IRMAA note");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(sent().body).toEqual({
      dueDate: null,
      notes: "Attach the Monte Carlo page and the IRMAA note",
    });
  });

  it("an unchanged Save just closes", async () => {
    const { user, dialog } = await openEditor();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("(I1) formatted Outlook notes are never offered as a blank box, and Save never sends notes", async () => {
    serverTodos = answer([FOUNDRY_TASK], [account([{ ...OUTLOOK_TODO, notes: "", notesAreHtml: true }])]);
    writeMock.mockResolvedValueOnce(respond(200, { ok: true }));
    const { user, dialog } = await openEditor();

    expect(within(dialog).queryByRole("textbox", { name: "Notes" })).toBeNull();
    expect(
      within(dialog).getByText("This to-do has formatted notes. Edit them in Outlook."),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Title"), "!");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(sent().body).toEqual({ title: "Send Hartley the updated plan!" });
  });

  it("a failed save keeps the dialog open and says so", async () => {
    writeMock.mockResolvedValueOnce(respond(503, { error: "throttled" }));
    const { user, dialog } = await openEditor();
    await user.type(within(dialog).getByLabelText("Title"), "!");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Couldn't save the to-do. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit to-do" })).toBeInTheDocument();
    expect(reads()).toHaveLength(1);
  });
});
