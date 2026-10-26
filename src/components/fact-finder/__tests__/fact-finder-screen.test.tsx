// @vitest-environment jsdom
// src/components/fact-finder/__tests__/fact-finder-screen.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SAVE_READING_MESSAGE, type PatchFactFinderBody, type ReadFrame } from "@/lib/fact-finder/api-types";
import type { ChangeSet } from "@/lib/fact-finder/change-set";
import { applyOps } from "@/lib/fact-finder/ops";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFChatTurn, FFClosed, FFFileReading, FFRow } from "@/lib/fact-finder/types";
import type { WsTable } from "@/lib/fact-finder/worksheet/types";
import { FactFinderScreen } from "../fact-finder-screen";
import type { FFScreenFile } from "../screen-types";

const FF_URL = "/api/clients/c1/imports/i1/fact-finder";
/** Noon UTC: the same calendar day in every US timezone. */
const AT = "2026-10-26T12:00:00.000Z";
const LATER = "2026-10-26T12:05:00.000Z";

const FILES: FFScreenFile[] = [{ id: "f1", name: "schwab-june.pdf", documentType: "auto" }];
/** f1 has been read, so the screen doesn't start a read as it opens. */
const READ: FFFileReading = { status: "done", startedAt: AT, rows: 1 };

const said = (id: string, text: string): FFChatTurn => ({ id, role: "user", text, at: AT });
const replied = (id: string, text: string): FFChatTurn => ({ id, role: "assistant", text, at: AT });
const PROPOSAL: FFChatTurn = { id: "p1", role: "proposal", rowIds: ["c1"], at: AT };

const checking: FFRow = {
  id: "c1",
  cells: { accountName: { value: "Joint Checking", by: "document", confidence: 0.99 } },
  link: { kind: "existing", recordId: "acct-1", score: 0.92, confirmed: true, by: "auto" },
  sourceFileIds: ["f1"],
};
const ACCOUNTS: WsTable = {
  id: "t1",
  title: "Accounts",
  columns: [{ id: "name", header: "Account", bind: { kind: "cell", columnId: "accountName" } }],
  rows: [{ id: "w1", cells: {}, ref: { rowId: "c1" }, source: { fileId: "f1", page: 2 } }],
};
const FAMILY: WsTable = {
  id: "t2",
  title: "Family",
  columns: [{ id: "name", header: "Name" }],
  rows: [{ id: "w2", cells: { name: "Mark Hendricks" } }],
};

/** f1 read and folded in: an Accounts and a Family table, and a conversation whose last reply can be undone. */
function worked(extra: Partial<FactFinderState> = {}): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    readings: { f1: READ },
    sections: { ...s.sections, cash: [checking] },
    worksheet: { tables: [ACCOUNTS, FAMILY], composedFileIds: ["f1"] },
    transcript: [replied("a0", "Built Accounts and Family from schwab-june.pdf.")],
    undo: { a0: [] },
    ...extra,
  };
}

/** What a review of c1 proposes: update Joint Checking's value on the plan. */
const CHANGES: ChangeSet = {
  builtAtVersion: 1,
  builtAt: AT,
  notices: [],
  hasCoClient: true,
  lines: [
    {
      id: "c1/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "c1",
      target: "account",
      action: "update",
      recordId: "acct-1",
      label: "Joint Checking",
      fields: [
        { key: "value", label: "Value", next: 41233, onRecord: 40000, shown: { next: "$41,233", onRecord: "$40,000" }, ticked: true, from: [] },
      ],
      warnings: [],
    },
  ],
};
const proposed = (): FactFinderState =>
  worked({ version: 1, changeSet: CHANGES, transcript: [said("u1", 'Match the "Accounts" table to the plan.'), PROPOSAL] });

const CLOSED: FFClosed = {
  at: AT,
  by: "user_1",
  saved: [{ lineId: "c1/account", rowId: "c1", target: "account", recordId: "acct-1", label: "Joint Checking" }],
  leftOut: [],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const sse = (frames: object[]) =>
  new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

type Answer = FactFinderState | Response;
type Route = (server: FactFinderState, body: unknown) => Answer | Promise<Answer>;
type RouteName = "read" | "turn" | "review" | "save" | "finish";

/**
 * The fact finder's routes, as the server keeps them. GET answers the saved
 * state; PATCH applies the ops (dropping the change set). Each POST route given
 * answers with a Response, or a fact finder it saves and sends back (a turn as
 * its done frame). Any other request fails the test.
 */
function stubServer(start: FactFinderState, routes: Partial<Record<RouteName, Route>> = {}) {
  let server = start;
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === FF_URL && method === "GET") return json(200, { factFinder: server });
      if (url === FF_URL && method === "PATCH") {
        const { ops } = body as PatchFactFinderBody;
        server = { ...applyOps(server, ops, { by: "advisor", now: AT, newId: () => "n1" }), version: server.version + 1 };
        delete server.changeSet;
        return json(200, { version: server.version, factFinder: server });
      }
      const name = url.slice(FF_URL.length + 1) as RouteName;
      const route = method === "POST" && url.startsWith(`${FF_URL}/`) ? routes[name] : undefined;
      if (!route) throw new Error(`unexpected ${method} ${url}`);
      const answer = await route(server, body);
      if (answer instanceof Response) return answer;
      server = answer;
      return name === "turn" ? sse([{ type: "done", factFinder: answer, turnId: null }]) : json(200, { factFinder: answer });
    }),
  );
  return {
    calls,
    posts: (name: RouteName) => calls.filter((c) => c.method === "POST" && c.url === `${FF_URL}/${name}`).map((c) => c.body),
    set: (next: FactFinderState) => {
      server = next;
    },
  };
}

/** Answers once, when the test lets it. */
function held(answer: Route) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { route: ((server, body) => gate.then(() => answer(server, body))) as Route, release };
}

function renderScreen(state: FactFinderState) {
  return render(<FactFinderScreen clientId="c1" importId="i1" initialState={state} initialFiles={FILES} />);
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

const panel = () => screen.getByRole("complementary", { name: "Documents & chat" });
const chat = () => screen.getByRole("region", { name: "Chat" });
const tableCard = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("section")!;
const banner = () => screen.queryByText(/^Finished/);

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("the fact finder screen", () => {
  it("shows the worksheet beside the chat", () => {
    stubScreenWidth(false);
    const net = stubServer(worked());
    renderScreen(worked());

    expect(screen.getByRole("heading", { level: 1, name: "Fact finder import" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to imports" })).toHaveAttribute("href", "/clients/c1/details/import");
    expect(screen.getByRole("button", { name: "Documents & chat" })).toHaveAttribute("aria-expanded", "true");
    // The panel holds the documents, the conversation and the composer; the worksheet sits beside it in the same grid.
    expect(within(panel()).getByRole("region", { name: "Documents" })).toBeInTheDocument();
    expect(within(chat()).getByText("Built Accounts and Family from schwab-june.pdf.")).toBeInTheDocument();
    expect(within(panel()).getByRole("textbox", { name: "Chat message" })).toBeEnabled();
    const accounts = tableCard("Accounts");
    expect(within(accounts).getByRole("cell", { name: /Joint Checking/ })).toHaveTextContent("schwab-june.pdf p.2");
    expect(panel()).not.toContainElement(accounts);
    expect(panel().parentElement).toContainElement(accounts);
    // Nothing needs reading, so opening the screen reads and composes nothing.
    expect(net.calls).toEqual([]);
  });

  it("below 1100 px the panel is a drawer over the worksheet, and the header button brings it back", async () => {
    stubScreenWidth(true);
    stubServer(worked());
    const user = userEvent.setup();
    renderScreen(worked());

    expect(screen.getByRole("dialog", { name: "Documents & chat" })).toHaveAttribute("aria-modal", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Documents & chat" })).toBeNull();
    expect(tableCard("Accounts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Documents & chat" }));
    expect(screen.getByRole("dialog", { name: "Documents & chat" })).toBeInTheDocument();
  });

  it("Match to plan sends the table's message", async () => {
    const answer = (server: FactFinderState, body: unknown): FactFinderState => {
      const { message } = body as { message: string };
      return { ...server, version: server.version + 1, transcript: [...server.transcript, said(`u${server.version}`, message)] };
    };
    const first = held(answer);
    const routes: Route[] = [first.route, answer];
    const net = stubServer(worked(), { turn: (server, body) => routes.shift()!(server, body) });
    const user = userEvent.setup();
    renderScreen(worked());

    await user.click(within(tableCard("Accounts")).getByRole("button", { name: "Match to plan" }));
    await waitFor(() => expect(net.posts("turn")).toEqual([{ message: 'Match the "Accounts" table to the plan.', match: { tableId: "t1" } }]));
    // While the reply runs, nothing else can be matched.
    expect(within(tableCard("Family")).getByRole("button", { name: "Match to plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Match all to plan" })).toBeDisabled();

    act(() => first.release());
    await waitFor(() => expect(screen.getByRole("button", { name: "Match all to plan" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Match all to plan" }));
    await waitFor(() =>
      expect(net.posts("turn")).toEqual([
        { message: 'Match the "Accounts" table to the plan.', match: { tableId: "t1" } },
        { message: "Match every table to the plan.", match: {} },
      ]),
    );
  });

  it("a finished read triggers compose once", async () => {
    const unread = worked({ readings: {}, worksheet: { tables: [], composedFileIds: [] }, transcript: [], undo: {} });
    const read = worked({ version: 1, worksheet: { tables: [], composedFileIds: [] }, transcript: [], undo: {} });
    const net = stubServer(unread, {
      read: () => {
        net.set(read);
        const frames: ReadFrame[] = [
          { type: "file", fileId: "f1", fileName: "schwab-june.pdf", status: "done", rows: 1 },
          { type: "done", summary: "Read 1 document.", caveats: [], version: 1 },
        ];
        return sse(frames);
      },
      turn: (server) => ({ ...worked(), version: server.version + 1 }),
    });
    renderScreen(unread);

    // The document still needed reading: the screen reads it as it opens, then folds it into the worksheet.
    await waitFor(() => expect(net.posts("turn")).toEqual([{ mode: "compose" }]));
    expect(await screen.findByRole("heading", { level: 3, name: "Accounts" })).toBeInTheDocument();
    expect(within(chat()).getByText("Built Accounts and Family from schwab-june.pdf.")).toBeInTheDocument();
    expect(net.posts("read")).toHaveLength(1);
    expect(net.posts("turn")).toHaveLength(1);
  });

  it("a document read but not yet on the worksheet is composed as the screen opens", async () => {
    // A compose that failed, or a reload while one ran, left f1 read but never folded in.
    const owed = worked({ worksheet: { tables: [ACCOUNTS, FAMILY], composedFileIds: [] } });
    const net = stubServer(owed, {
      turn: (server) => ({ ...server, version: server.version + 1, worksheet: { ...server.worksheet, composedFileIds: ["f1"] } }),
    });
    renderScreen(owed);

    await waitFor(() => expect(net.posts("turn")).toEqual([{ mode: "compose" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Match all to plan" })).toBeEnabled());
    expect(net.posts("turn")).toHaveLength(1);
  });

  it("a compose that keeps failing is tried twice per page load, then left alone", async () => {
    const owed = worked({ worksheet: { tables: [ACCOUNTS, FAMILY], composedFileIds: [] } });
    const net = stubServer(owed, { turn: () => sse([{ type: "error", message: "Could not process that message. Please try again." }]) });
    renderScreen(owed);

    await waitFor(() => expect(net.posts("turn")).toEqual([{ mode: "compose" }, { mode: "compose" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Match all to plan" })).toBeEnabled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(net.posts("turn")).toHaveLength(2);
  });

  it("a read that finishes while a reply runs is composed once the reply lands", async () => {
    // Both documents failed their last read, so the screen reads them only on Retry, and the advisor retries them mid-reply.
    const failed: FFFileReading = { status: "failed", startedAt: AT, reason: "Couldn't read this document — try again." };
    let latest = worked({ readings: { f1: failed, f2: failed }, worksheet: { tables: [ACCOUNTS, FAMILY], composedFileIds: [] } });
    const reads = ["f1", "f2"];
    const reply = held(() => ({ ...latest, version: latest.version + 1, transcript: [...latest.transcript, replied("a1", "Matched.")] }));
    const net = stubServer(latest, {
      read: () => {
        const fileId = reads.shift()!;
        latest = { ...latest, version: latest.version + 1, readings: { ...latest.readings, [fileId]: READ } };
        net.set(latest);
        const frames: ReadFrame[] = [
          { type: "file", fileId, fileName: `${fileId}.pdf`, status: "done", rows: 1 },
          { type: "done", summary: "Read 1 document.", caveats: [], version: latest.version },
        ];
        return sse(frames);
      },
      turn: (server, body) =>
        (body as { mode?: string }).mode === "compose"
          ? { ...server, version: server.version + 1, worksheet: { ...server.worksheet, composedFileIds: ["f1", "f2"] } }
          : reply.route(server, body),
    });
    const user = userEvent.setup();
    const files: FFScreenFile[] = [...FILES, { id: "f2", name: "fidelity-401k.pdf", documentType: "auto" }];
    render(<FactFinderScreen clientId="c1" importId="i1" initialState={latest} initialFiles={files} />);

    await user.click(screen.getByRole("button", { name: "Match all to plan" }));
    await waitFor(() => expect(net.posts("turn")).toEqual([{ message: "Match every table to the plan.", match: {} }]));
    // Two reads finish while the reply runs: nothing can fold them in yet.
    await user.click(screen.getByRole("button", { name: "Retry reading schwab-june.pdf" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry reading schwab-june.pdf" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Retry reading fidelity-401k.pdf" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry reading fidelity-401k.pdf" })).toBeNull());
    expect(net.posts("read")).toHaveLength(2);
    expect(net.posts("turn")).toHaveLength(1);

    // The reply lands: one compose folds both documents in, and nothing runs after it.
    act(() => reply.release());
    await waitFor(() => expect(net.posts("turn")).toEqual([{ message: "Match every table to the plan.", match: {} }, { mode: "compose" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Match all to plan" })).toBeEnabled());
    await waitFor(() => expect(within(chat()).getByText("Matched.")).toBeInTheDocument());
    expect(net.posts("turn")).toHaveLength(2);
  });

  it("Finish import asks first, then shows the closed banner", async () => {
    const net = stubServer(worked(), { finish: (server) => ({ ...server, version: server.version + 1, closed: CLOSED }) });
    const user = userEvent.setup();
    renderScreen(worked());

    await user.click(screen.getByRole("button", { name: "Finish import" }));
    let dialog = screen.getByRole("dialog", { name: "Finish import" });
    expect(dialog).toHaveTextContent(
      "Finish this import? You can't add documents or save more changes to the plan from it afterwards.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Finish import" })).toBeNull();
    expect(net.posts("finish")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Finish import" }));
    dialog = screen.getByRole("dialog", { name: "Finish import" });
    await user.click(within(dialog).getByRole("button", { name: "Finish import" }));

    await waitFor(() => expect(banner()).toHaveTextContent("Finished October 26, 2026 — 1 item(s) saved to the plan."));
    expect(net.posts("finish")).toHaveLength(1);
    // The controls that had focus are gone: the banner takes it.
    expect(banner()).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Finish import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish import" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Chat message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Match to plan" })).toBeNull();
  });

  it("a refused finish shows why and leaves the import open", async () => {
    stubServer(worked(), { finish: () => json(409, { error: SAVE_READING_MESSAGE }) });
    const user = userEvent.setup();
    renderScreen(worked());

    await user.click(screen.getByRole("button", { name: "Finish import" }));
    await user.click(within(screen.getByRole("dialog", { name: "Finish import" })).getByRole("button", { name: "Finish import" }));

    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(await within(header).findByRole("alert")).toHaveTextContent(SAVE_READING_MESSAGE);
    expect(screen.queryByRole("dialog", { name: "Finish import" })).toBeNull();
    expect(banner()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
    await user.click(within(header).getByRole("button", { name: "Dismiss" }));
    expect(within(header).queryByRole("alert")).toBeNull();
  });

  it("a closed import is read-only", () => {
    // f1 was never read: a finished import still reads nothing as it opens.
    const closed = worked({ readings: {}, closed: CLOSED, changeSet: CHANGES, transcript: [said("u1", "Match it."), PROPOSAL, replied("a1", "Saved to the plan: Joint Checking (updated)")], undo: { a1: [] } });
    const net = stubServer(closed);
    renderScreen(closed);

    expect(banner()).toHaveTextContent("Finished October 26, 2026 — 1 item(s) saved to the plan.");
    expect(banner()).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "Finish import" })).toBeNull();
    // The worksheet, without its Match buttons.
    expect(tableCard("Accounts")).toBeInTheDocument();
    expect(tableCard("Family")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Match/ })).toBeNull();
    // The conversation, without its composer, uploads, Undo or proposal cards.
    expect(within(chat()).getByText("Saved to the plan: Joint Checking (updated)")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Chat message" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Documents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(net.calls).toEqual([]);
  });

  it("a closed import keeps its summary: what went to the plan, each with its Details page, and what was left out and why", () => {
    // Closed by the Claude connector's save: no chat turn says what saved.
    const summary: FFClosed = {
      ...CLOSED,
      saved: [...CLOSED.saved, { lineId: "i1/income", rowId: "i1", target: "income", recordId: "inc-1", label: "Acme salary" }],
      leftOut: [{ lineId: "l1/liability", rowId: "l1", label: "Car loan", reason: "Needs an owner" }],
    };
    const closed = worked({ closed: summary, transcript: [] });
    stubServer(closed);
    renderScreen(closed);

    expect(banner()).toHaveTextContent("Finished October 26, 2026 — 2 item(s) saved to the plan.");
    const saved = screen.getByRole("list", { name: "Saved to the plan" });
    expect(within(saved).getByRole("link", { name: "Joint Checking" })).toHaveAttribute("href", "/clients/c1/details/net-worth");
    expect(within(saved).getByRole("link", { name: "Acme salary" })).toHaveAttribute("href", "/clients/c1/details/income-expenses");
    const leftOut = screen.getByRole("list", { name: "Left out" });
    expect(within(leftOut).getByRole("listitem")).toHaveTextContent(/Car loan\s*Needs an owner/);
  });

  it("a closed import with nothing left out lists no Left out group", () => {
    const closed = worked({ closed: CLOSED });
    stubServer(closed);
    renderScreen(closed);

    expect(within(screen.getByRole("list", { name: "Saved to the plan" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Left out" })).toBeNull();
  });

  it("a proposal turn renders a proposal card", async () => {
    const net = stubServer(proposed(), {
      save: (server) => ({
        ...server,
        version: server.version + 1,
        changeSet: undefined,
        applied: [{ lineId: "c1/account", rowId: "c1", target: "account", recordId: "acct-1", label: "Joint Checking", at: LATER }],
        transcript: [...server.transcript, replied("a2", "Saved to the plan: Joint Checking (updated)")],
      }),
    });
    const user = userEvent.setup();
    renderScreen(proposed());

    expect(within(chat()).getByRole("heading", { name: "Joint Checking" })).toBeInTheDocument();
    await user.click(within(chat()).getByRole("button", { name: "Save 1 change to the plan" }));

    // A round of the chat's: the import stays open for the next.
    await waitFor(() =>
      expect(net.posts("save")).toEqual([{ changeSetVersion: 1, ticks: { "c1/account": { value: true } }, keepOpen: true }]),
    );
    expect(await within(chat()).findByText("Saved.")).toBeInTheDocument();
    expect(within(chat()).getByText("Saved to the plan: Joint Checking (updated)")).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it("Add as new instead links the row as new, saves that, then proposes the row again", async () => {
    const asNew: ChangeSet = {
      ...CHANGES,
      builtAtVersion: 3,
      lines: [{ ...CHANGES.lines[0], action: "create", recordId: null, fields: [{ ...CHANGES.lines[0].fields[0], onRecord: undefined, shown: { next: "$41,233" } }] }],
    };
    const net = stubServer(proposed(), { review: (server) => ({ ...server, version: server.version + 1, changeSet: asNew }) });
    const user = userEvent.setup();
    renderScreen(proposed());

    await user.click(within(chat()).getByRole("button", { name: "Add as new instead" }));

    await waitFor(() => expect(net.posts("review")).toEqual([{ rowIds: ["c1"] }]));
    expect(net.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH ${FF_URL}`, `POST ${FF_URL}/review`]);
    expect((net.calls[0].body as PatchFactFinderBody).ops).toEqual([
      { op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "new" } },
    ]);
    await waitFor(() => expect(within(chat()).queryByRole("button", { name: "Add as new instead" })).toBeNull());
    expect(within(chat()).getByRole("button", { name: "Save 1 change to the plan" })).toBeEnabled();
  });
});
