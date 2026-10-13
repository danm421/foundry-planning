// @vitest-environment jsdom
// src/components/fact-finder/__tests__/chat-panel.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TURN_BUSY_MESSAGE, type PatchFactFinderBody } from "@/lib/fact-finder/api-types";
import { applyOps } from "@/lib/fact-finder/ops";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFChatTurn, FFFileReading } from "@/lib/fact-finder/types";
import { FactFinderScreen } from "../fact-finder-screen";
import type { FFScreenFile } from "../screen-types";

const FF_URL = "/api/clients/c1/imports/i1/fact-finder";
const TURN_URL = `${FF_URL}/turn`;
const UNDO_URL = `${FF_URL}/undo`;
const AT = "2026-10-13T09:00:00.000Z";
const MESSAGE = "Add an IRA at Fidelity for Laura worth 40,000";

const FILES: FFScreenFile[] = [{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }];
/** f1 has been read, so the screen doesn't start a read as it opens. */
const READ: FFFileReading = { status: "done", startedAt: AT, rows: 1 };

const said = (id: string, text: string): FFChatTurn => ({ id, role: "user", text, at: AT });
const replied = (id: string, text: string): FFChatTurn => ({ id, role: "assistant", text, at: AT });
const did = (id: string, summary: string, tool = "set_cell"): FFChatTurn => ({ id, role: "tool", tool, summary, at: AT });

/** The read's summary, then one reply that changed a cash account (it can be undone). */
function chatted(): FactFinderState {
  return {
    ...emptyFactFinderState(),
    readings: { f1: READ },
    transcript: [
      replied("a0", "Read 1 document.\n• 2 values to check."),
      said("u1", "Joint Checking is 13,000 now"),
      did("t1", 'Set Current value on "Joint Checking" to 13000'),
      replied("a1", "Done — Joint Checking now shows $13,000."),
    ],
    undo: { a1: [] },
  };
}

/** The server's state after a reply to MESSAGE that added a row (its Undo is stored under a2). */
const afterTurn = (s: FactFinderState): FactFinderState => ({
  ...s,
  version: s.version + 1,
  transcript: [
    ...s.transcript,
    said("u2", MESSAGE),
    did("t2", 'Added "Fidelity IRA" to Retirement Accounts', "add_row"),
    replied("a2", "Added Laura's Fidelity IRA."),
  ],
  undo: { ...s.undo, a2: [] },
});
/** The server's state after undoing a1. */
const afterUndo = (s: FactFinderState): FactFinderState => ({
  ...s,
  version: s.version + 1,
  transcript: [...s.transcript, did("t9", "Undid that reply", "undo")],
  undo: {},
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Answers once, when the test lets it: shows what the screen does while a request is in flight. */
function held(answer: (server: FactFinderState) => Response) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reply: (server: FactFinderState) => gate.then(() => answer(server)), release };
}

type Reply = "offline" | ((server: FactFinderState) => Response | Promise<Response>);

/**
 * The fact finder's routes. PATCH saves the edits onto `start` (or can't be
 * reached, with `saves: "offline"`); GET answers `fresh`; each turn or undo
 * POST takes the next queued reply, given the saved state. `log` lists the
 * requests in order, `sent` the turn and undo bodies.
 */
function stubFetch(
  start: FactFinderState,
  routes: { turn?: Reply[]; undo?: Reply[]; saves?: "offline"; fresh?: FactFinderState } = {},
) {
  let server = start;
  const log: string[] = [];
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      log.push(`${method} ${url}`);
      if (url === FF_URL && method === "PATCH") {
        if (routes.saves === "offline") throw new TypeError("Failed to fetch");
        const { ops } = JSON.parse(String(init?.body)) as PatchFactFinderBody;
        server = { ...applyOps(server, ops, { by: "advisor", now: AT, newId: () => "n1" }), version: server.version + 1 };
        return json(200, { version: server.version, factFinder: server });
      }
      if (url === FF_URL && method === "GET") return json(200, { factFinder: routes.fresh ?? server });
      const queue = url === TURN_URL ? routes.turn : url === UNDO_URL ? routes.undo : undefined;
      if (method !== "POST" || !queue) throw new Error(`unexpected ${method} ${url}`);
      sent.push(JSON.parse(String(init?.body)));
      const next = queue.shift();
      if (!next) throw new Error(`no reply queued for ${url}`);
      if (next === "offline") throw new TypeError("Failed to fetch");
      return next(server);
    }),
  );
  return { log, sent };
}

function renderScreen(state: FactFinderState) {
  return render(
    <FactFinderScreen clientId="c1" importId="i1" initialState={state} initialFiles={FILES} entities={[]} />,
  );
}

/** Narrow = the screen is below 1100 px, as `(max-width: 1099px)` reports it. */
function stubScreenWidth(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query === "(max-width: 1099px)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const openPanel = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Documents & chat" }));
const panel = () => screen.getByRole("complementary", { name: "Documents & chat" });
const chat = () => screen.getByRole("region", { name: "Chat" });
const composer = () => screen.getByRole("textbox", { name: "Chat message" });
/** The reply's list item, found by its text. */
const reply = (text: string | RegExp) => within(chat()).getByText(text).closest("li")!;
/** Saves a typed edit: the co-client's first name (it goes out with the next save). */
const typeCoClientName = async (user: ReturnType<typeof userEvent.setup>) =>
  user.type(screen.getAllByRole("textbox", { name: "First name" })[1], "Laura{Enter}");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the conversation", () => {
  it("shows the messages, each change a reply made in plain words, and Undo only on replies that can be undone", async () => {
    const user = userEvent.setup();
    renderScreen(chatted());
    await openPanel(user);

    expect(within(panel()).getByRole("heading", { level: 3, name: "Chat" })).toBeInTheDocument();
    const lines = within(chat()).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      "Read 1 document.\n• 2 values to check.",
      "Joint Checking is 13,000 now",
      'Set Current value on "Joint Checking" to 13000',
      "Done — Joint Checking now shows $13,000.Undo",
    ]);
    expect(chat()).not.toHaveTextContent("set_cell");
    expect(within(chat()).getAllByRole("button", { name: "Undo" })).toHaveLength(1);
    expect(within(reply("Done — Joint Checking now shows $13,000.")).getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(within(reply(/^Read 1 document/)).queryByRole("button")).toBeNull();
  });

  it("invites a first message when there is no conversation yet", async () => {
    const user = userEvent.setup();
    renderScreen({ ...emptyFactFinderState(), readings: { f1: READ } });
    await openPanel(user);
    expect(within(chat()).getByText("Ask a question about this fact finder, or say what to change.")).toBeInTheDocument();
    // Short enough for one line of the composer in the 360 px panel and drawer (about 28 characters fit).
    expect(composer()).toHaveAttribute("placeholder", "Ask, or say what to change…");
    expect(composer()).toBeEnabled();
  });
});

describe("sending a message", () => {
  it("saves the edits typed before it, shows it on its way, then shows the reply and its changes", async () => {
    const user = userEvent.setup();
    const turn = held((server) => json(200, { factFinder: afterTurn(server), turnId: "a2" }));
    const net = stubFetch(chatted(), { turn: [turn.reply] });
    renderScreen(chatted());
    await openPanel(user);

    await typeCoClientName(user);
    await user.type(composer(), `${MESSAGE}{Enter}`);

    await waitFor(() => expect(net.log).toEqual([`PATCH ${FF_URL}`, `POST ${TURN_URL}`]));
    expect(net.sent).toEqual([{ message: MESSAGE }]);
    expect(composer()).toHaveValue("");
    expect(within(chat()).getByText(MESSAGE)).toBeInTheDocument();
    expect(within(chat()).getByText("Working on it…")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(within(chat()).getByRole("button", { name: "Undo" })).toBeDisabled();

    act(() => turn.release());
    expect(await within(chat()).findByText("Added Laura's Fidelity IRA.")).toBeInTheDocument();
    expect(within(chat()).getByText('Added "Fidelity IRA" to Retirement Accounts')).toBeInTheDocument();
    expect(within(chat()).queryByText("Working on it…")).toBeNull();
    expect(within(chat()).getAllByText(MESSAGE)).toHaveLength(1);
    expect(within(reply("Added Laura's Fidelity IRA.")).getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getAllByRole("textbox", { name: "First name" })[1]).toHaveValue("Laura");
    expect(within(panel()).getByRole("button", { name: "Send" })).toBeDisabled(); // nothing typed
  });

  it.each([
    ["a document started reading (409)", json(409, { error: TURN_BUSY_MESSAGE }), TURN_BUSY_MESSAGE],
    [
      "too many messages (429)",
      json(429, { error: "Too many requests. Please wait a moment and try again." }, { "retry-after": "30" }),
      "Too many requests. Please wait a moment and try again. Retry in 30s.",
    ],
    [
      "the reply failed (500)",
      json(500, { error: "Could not process that message. Please try again." }),
      "Could not process that message. Please try again.",
    ],
    ["a gateway error with no message (502)", new Response("Bad gateway", { status: 502 }), "Couldn't send that (HTTP 502)."],
  ])("when %s, shows why and keeps the message in the box", async (_, response, shown) => {
    const user = userEvent.setup();
    const net = stubFetch(chatted(), { turn: [() => response] });
    renderScreen(chatted());
    await openPanel(user);

    await user.type(composer(), `${MESSAGE}{Enter}`);

    expect(await within(panel()).findByRole("alert")).toHaveTextContent(shown);
    expect(composer()).toHaveValue(MESSAGE);
    expect(within(chat()).queryByText(MESSAGE)).toBeNull();
    expect(within(chat()).queryByText("Working on it…")).toBeNull();
    expect(net.log).toEqual([`POST ${TURN_URL}`]);
  });

  it("when the server can't be reached, says so in plain words and keeps the message", async () => {
    const user = userEvent.setup();
    stubFetch(chatted(), { turn: ["offline"] });
    renderScreen(chatted());
    await openPanel(user);

    await user.type(composer(), `${MESSAGE}{Enter}`);

    expect(await within(panel()).findByRole("alert")).toHaveTextContent("Couldn't reach the server. Check your connection.");
    expect(composer()).toHaveValue(MESSAGE);
  });

  it("sends nothing while typed edits can't be saved: the message stays, and Undo waits too", async () => {
    const user = userEvent.setup();
    const net = stubFetch(chatted(), { turn: [], undo: [], saves: "offline" });
    renderScreen(chatted());
    await openPanel(user);
    await typeCoClientName(user);

    await user.type(composer(), `${MESSAGE}{Enter}`);
    const unsaved = "Your latest edits haven't saved yet — try again once they're saved.";
    expect(await within(panel()).findByRole("alert")).toHaveTextContent(unsaved);
    expect(composer()).toHaveValue(MESSAGE);

    await user.click(within(chat()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(within(panel()).getByRole("alert")).toHaveTextContent(unsaved));
    expect(net.log.filter((request) => request.startsWith("POST"))).toEqual([]);
  });
});

describe("while a document is reading (Review Focus 4)", () => {
  it("the composer is disabled and says why, and opens up once the reading ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const reading: FactFinderState = { ...chatted(), readings: { f1: { status: "reading", startedAt: new Date().toISOString() } } };
    stubFetch(reading, { fresh: { ...chatted(), version: 1 } });
    renderScreen(reading); // the panel opens by default while reading

    const reason = "Still reading your documents — you can ask once that finishes.";
    expect(composer()).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(within(panel()).getByText(reason)).toBeInTheDocument();

    // The screen checks on the reading every 5 s; this check finds it finished.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(composer()).toBeEnabled();
    expect(within(panel()).queryByText(reason)).toBeNull();
  });
});

describe("Undo", () => {
  it("sends the reply's id, then shows the fact finder as it was before that reply", async () => {
    const user = userEvent.setup();
    const undo = held((server) => json(200, { factFinder: afterUndo(server) }));
    const net = stubFetch(chatted(), { undo: [undo.reply] });
    renderScreen(chatted());
    await openPanel(user);

    await user.click(within(reply("Done — Joint Checking now shows $13,000.")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(net.sent).toEqual([{ turnId: "a1" }]));
    expect(within(chat()).getByRole("button", { name: "Undoing…" })).toBeDisabled();
    expect(composer()).toBeDisabled();

    act(() => undo.release());
    expect(await within(chat()).findByText("Undid that reply")).toBeInTheDocument();
    expect(within(chat()).queryByRole("button", { name: /^Undo/ })).toBeNull();
    expect(composer()).toBeEnabled();
    expect(net.log).toEqual([`POST ${UNDO_URL}`]);
  });

  it("shows the server's refusal word for word, and the reply keeps its Undo", async () => {
    const user = userEvent.setup();
    const refusal = 'Can\'t undo — "Joint Checking" has changed since that reply.';
    stubFetch(chatted(), { undo: [() => json(409, { error: refusal })] });
    renderScreen(chatted());
    await openPanel(user);

    await user.click(within(chat()).getByRole("button", { name: "Undo" }));

    expect(await within(panel()).findByRole("alert")).toHaveTextContent(refusal);
    expect(within(panel()).getByRole("alert").textContent).toBe(refusal);
    expect(within(chat()).getByRole("button", { name: "Undo" })).toBeEnabled();
  });
});

describe("layout", () => {
  it.each([
    ["beside the page", false, "complementary"],
    ["in the drawer below 1100 px", true, "dialog"],
  ] as const)("the composer stays under the part of the panel that scrolls, %s", async (_, narrow, role) => {
    stubScreenWidth(narrow);
    const user = userEvent.setup();
    renderScreen(chatted());
    await openPanel(user);

    const surface = screen.getByRole(role, { name: "Documents & chat" });
    const box = within(surface).getByRole("textbox", { name: "Chat message" });
    const scroller = within(surface).getByRole("region", { name: "Documents" }).closest(".overflow-y-auto");
    expect(scroller).toContainElement(within(surface).getByRole("region", { name: "Chat" }));
    expect(scroller).not.toContainElement(box);
  });

  it("brings a new message into view, but doesn't jump when the panel opens", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled; // jsdom has none
    try {
      const user = userEvent.setup();
      const turn = held((server) => json(200, { factFinder: afterTurn(server), turnId: "a2" }));
      stubFetch(chatted(), { turn: [turn.reply] });
      renderScreen(chatted());
      await openPanel(user);
      expect(scrolled).not.toHaveBeenCalled();

      await user.type(composer(), `${MESSAGE}{Enter}`);
      await within(chat()).findByText("Working on it…");
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });

      act(() => turn.release());
      await within(chat()).findByText("Added Laura's Fidelity IRA.");
      expect(scrolled).toHaveBeenCalledTimes(2);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
