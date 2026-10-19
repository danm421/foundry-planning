// @vitest-environment jsdom
// src/components/fact-finder/__tests__/fact-finder-screen.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FactFinderScreen } from "../fact-finder-screen";
import type { FFScreenFile } from "../screen-types";
import { REVIEW_READING_MESSAGE, SAVE_STALE_MESSAGE, type PatchFactFinderBody, type SaveBody } from "@/lib/fact-finder/api-types";
import type { ChangeSet } from "@/lib/fact-finder/change-set";
import { applyOps } from "@/lib/fact-finder/ops";
import { sectionsOnPage } from "@/lib/fact-finder/schema";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCell, FFChatTurn, FFFileReading, FFRow } from "@/lib/fact-finder/types";

const lowConfidence = (value: string): FFCell => ({ value, confidence: 0.5, by: "document", source: { fileId: "f1" } });
const suggested = (recordId: string): FFRow["link"] => ({ kind: "existing", recordId, score: 0.74, confirmed: false, by: "auto" });
const cashRow = (id: string, recordId: string): FFRow => ({
  id,
  cells: { accountName: lowConfidence("Joint Checking") },
  link: suggested(recordId),
  sourceFileIds: ["f1"],
});

/** f1 has been read, so the screen doesn't start a read as it opens. */
const READ: FFFileReading = { status: "done", startedAt: "2026-10-13T09:00:00.000Z", rows: 1 };

/** Mark typed in by hand on Household; one cash account to check, with a link that needs a click. */
function filled(): FactFinderState {
  const s = emptyFactFinderState();
  const [client, coClient] = s.sections.people;
  return {
    ...s,
    readings: { f1: READ },
    sections: {
      ...s.sections,
      people: [{ ...client, cells: { firstName: { value: "Mark", by: "advisor", pinned: true } } }, coClient],
      cash: [cashRow("c1", "acct-1")],
    },
  };
}
const twoLinks = (): FactFinderState => {
  const s = filled();
  return { ...s, sections: { ...s.sections, cash: [cashRow("c1", "acct-1"), cashRow("c2", "acct-2")] } };
};
const reading = (): FactFinderState => ({
  ...filled(),
  readings: { f1: { status: "reading", startedAt: new Date().toISOString() } },
});
/** Read, nothing to link: ready to review. One cash account, typed in. */
function ready(): FactFinderState {
  const s = filled();
  return { ...s, sections: { ...s.sections, cash: [{ ...cashRow("c1", "acct-1"), link: undefined }] } };
}

const FF_URL = "/api/clients/c1/imports/i1/fact-finder";
const REVIEW_URL = `${FF_URL}/review`;
const SAVE_URL = `${FF_URL}/save`;

/** What the review makes of `ready()`: Joint Checking to create, and a line that can't save until its name is fixed. */
const changesAt = (builtAtVersion: number): ChangeSet => ({
  builtAtVersion,
  builtAt: "2026-10-13T10:00:00.000Z",
  notices: [],
  lines: [
    {
      id: "c1/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "c1",
      target: "account",
      action: "create",
      recordId: null,
      label: "Joint Checking",
      fields: [
        { key: "name", label: "Name", next: "Joint Checking", shown: { next: "Joint Checking" }, ticked: true, from: [] },
        { key: "value", label: "Value", next: 41233, shown: { next: "$41,233" }, ticked: true, from: [] },
      ],
      warnings: [],
    },
    {
      id: "c1/account/1",
      page: "accounts",
      sectionId: "cash",
      rowId: "c1",
      target: "account",
      action: "create",
      recordId: null,
      label: "Joint Checking (copy)",
      fields: [],
      warnings: [],
      blocked: { reason: "Needs Name.", cell: { sectionId: "cash", rowId: "c1", columnId: "accountName" } },
    },
  ],
});
const reviewedAt = (s: FactFinderState): FactFinderState => ({ ...s, version: s.version + 1, changeSet: changesAt(s.version + 1) });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The chat's answer to any message. */
const REPLY: FFChatTurn = { id: "t1", role: "assistant", text: "Two values still need a check.", at: READ.startedAt };

/**
 * The fact finder's routes, as the server keeps them: a save drops the change
 * set when it changes the rows. PATCH saves edits (so it drops it), or never
 * answers with `holdSaves`; review answers with `review` (default: the change
 * set built on the saved state); a turn adds `REPLY` to the transcript, one
 * version on, and keeps the change set unless `turnEdits` (a reply that
 * changed a value). `log` lists requests in order.
 */
function stubServer(
  start: FactFinderState,
  review: (server: FactFinderState) => Response | Promise<Response> = (s) => json(200, { factFinder: reviewedAt(s) }),
  {
    holdSaves = false,
    turnEdits = false,
    save = undefined as ((server: FactFinderState, body: SaveBody) => Response | Promise<Response>) | undefined,
    patch = undefined as ((server: FactFinderState) => Response | Promise<Response>) | undefined,
  } = {},
) {
  let server = start;
  const log: string[] = [];
  const keep = (next: FactFinderState, rowsChanged: boolean) => {
    server = { ...next };
    if (rowsChanged) delete server.changeSet;
    return server;
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      log.push(`${method} ${url}`);
      if (url === FF_URL && method === "PATCH") {
        if (holdSaves) return new Promise<Response>(() => {});
        if (patch) return patch(server);
        const { ops } = JSON.parse(String(init?.body)) as PatchFactFinderBody;
        const saved = keep({ ...applyOps(server, ops, { by: "advisor", now: READ.startedAt, newId: () => "n1" }), version: server.version + 1 }, true);
        return json(200, { version: saved.version, factFinder: saved });
      }
      if (url === FF_URL && method === "GET") return json(200, { factFinder: server });
      if (url === `${FF_URL}/turn` && method === "POST") {
        const answered = { ...server, version: server.version + 1, transcript: [...server.transcript, REPLY] };
        return json(200, { factFinder: keep(answered, turnEdits), turnId: null });
      }
      if (url === SAVE_URL && method === "POST" && save) return save(server, JSON.parse(String(init?.body)) as SaveBody);
      if (url === REVIEW_URL && method === "POST") {
        const res = await review(server);
        const body = (await res.clone().json()) as { factFinder?: FactFinderState };
        if (res.ok && body.factFinder) server = body.factFinder;
        return res;
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return { log, reviews: () => log.filter((l) => l === `POST ${REVIEW_URL}`).length };
}

/** Answers once, when the test lets it. */
function held(answer: (server: FactFinderState) => Response) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reply: (server: FactFinderState) => gate.then(() => answer(server)), release };
}

const FILES: FFScreenFile[] = [{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }];

function renderScreen(state: FactFinderState = filled()) {
  return render(
    <FactFinderScreen clientId="c1" importId="i1" initialState={state} initialFiles={FILES} entities={[]} hasCoClient />,
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

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("page rail", () => {
  it("lists the seven pages in order, with a dot for pages with values and their counts", () => {
    renderScreen(twoLinks());
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    const pages = within(rail).getAllByRole("button");
    expect(pages).toHaveLength(7);
    [
      "Household, has values",
      "Accounts, has values, 2 values to check, 2 links to confirm",
      "Real estate & debts",
      "Income",
      "Expenses & savings",
      "Insurance",
      "Estate",
    ].forEach((name, i) => expect(pages[i]).toHaveAccessibleName(name));
  });

  it("marks the selected page and switches the main area to the page clicked", async () => {
    renderScreen();
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    expect(within(rail).getByRole("button", { name: /^Household/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "Household" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Client & Co-client" })).toBeInTheDocument();

    await userEvent.click(within(rail).getByRole("button", { name: /^Accounts/ }));

    expect(within(rail).getByRole("button", { name: /^Accounts/ })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("button", { name: /^Household/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      sectionsOnPage("accounts").map((s) => s.label),
    );
    expect(screen.queryByRole("heading", { name: "Client & Co-client" })).toBeNull();
  });

  it("shows the selected page's sections as tables, naming each value's source from the uploaded files", async () => {
    renderScreen();
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    await userEvent.click(within(rail).getByRole("button", { name: /^Accounts/ }));
    const cash = screen.getByRole("table", { name: "Cash Accounts" });
    expect(within(cash).getByRole("textbox", { name: "Account name" })).toHaveValue("Joint Checking");
    expect(within(cash).getByRole("tooltip")).toHaveTextContent("From hendricks-fact-finder.pdf");
  });
});

describe("Review changes", () => {
  it.each([
    ["a document is still reading", reading(), "Wait for the documents to finish reading."],
    ["two links need a click", twoLinks(), "2 links need a click first."],
    ["one link needs a click", filled(), "1 link needs a click first."],
  ])("stays disabled when %s, and says why", (_case, state, reason) => {
    renderScreen(state);
    const review = screen.getByRole("button", { name: "Review changes →" });
    expect(review).toBeDisabled();
    expect(review).toHaveAccessibleDescription(reason);
  });

  it("is ready when nothing blocks it", () => {
    renderScreen(ready());
    const review = screen.getByRole("button", { name: "Review changes →" });
    expect(review).toBeEnabled();
    expect(review).toHaveAccessibleDescription("");
  });

  it("links back to the imports list", () => {
    renderScreen();
    expect(screen.getByRole("link", { name: "← Back to imports" })).toHaveAttribute("href", "/clients/c1/details/import");
    expect(screen.getByRole("heading", { level: 1, name: "Fact finder import" })).toBeInTheDocument();
  });

  it("says in the header that changes save automatically", () => {
    renderScreen();
    expect(within(screen.getByRole("banner")).getByText("Changes save automatically")).toBeInTheDocument();
  });
});

describe("side panel", () => {
  it("starts closed when nothing is reading; the header button shows it and its close button hides it", async () => {
    renderScreen();
    const toggle = screen.getByRole("button", { name: "Documents & chat" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Documents & chat" })).toBeNull();

    await userEvent.click(toggle);
    const panel = screen.getByRole("complementary", { name: "Documents & chat" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const lines = within(panel).getByRole("list", { name: "Reading progress" });
    expect(within(lines).getByText("hendricks-fact-finder.pdf")).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Hide documents & chat" }));
    expect(screen.queryByRole("complementary", { name: "Documents & chat" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open on an import with no documents yet, so the drop zone is the first thing there", () => {
    render(<FactFinderScreen clientId="c1" importId="i1" initialState={emptyFactFinderState()} initialFiles={[]} entities={[]} hasCoClient />);
    const panel = screen.getByRole("complementary", { name: "Documents & chat" });
    expect(within(panel).getByText(/Drag & drop files here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents & chat" })).toHaveAttribute("aria-expanded", "true");
  });

  it("starts open while a document is reading", () => {
    renderScreen(reading());
    expect(screen.getByRole("complementary", { name: "Documents & chat" })).toBeInTheDocument();
  });

  it("is an overlay drawer below 1100 px: it takes focus, locks the page scroll, and Escape closes it", async () => {
    stubScreenWidth(true);
    renderScreen();
    const toggle = screen.getByRole("button", { name: "Documents & chat" });
    await userEvent.click(toggle);

    const drawer = screen.getByRole("dialog", { name: "Documents & chat" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.queryByRole("complementary")).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(toggle).toHaveFocus();
  });

  it("stays beside the page at 1100 px and wider, in a grid at least as tall as the panel can be", async () => {
    stubScreenWidth(false);
    renderScreen();
    const grid = screen.getByRole("navigation", { name: "Fact finder pages" }).parentElement as HTMLElement;
    expect(grid.style.minHeight).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Documents & chat" }));
    const panel = screen.getByRole("complementary", { name: "Documents & chat" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // At most the window less its 100 px sticky line and 84 px Forge clearance: so the grid's end
    // is always the page's, which the panel measures to stay under the app's header.
    expect(panel.parentElement).toBe(grid);
    expect(grid.style.minHeight).toBe("calc(100vh - 184px)");
  });
});

describe("the change list", () => {
  const reviewButton = () => screen.getByRole("button", { name: "Review changes →" });
  const changeList = () => screen.queryByRole("heading", { level: 2, name: "Changes to the plan" });

  it("reviews when pressed: Reviewing… while it runs, then the change list in place of the page, the rail still there", async () => {
    const user = userEvent.setup();
    const answer = held((s) => json(200, { factFinder: reviewedAt(s) }));
    const net = stubServer(ready(), answer.reply);
    renderScreen(ready());

    await user.click(reviewButton());
    const busy = screen.getByRole("button", { name: "Reviewing…" });
    expect(busy).toBeDisabled();
    await waitFor(() => expect(net.log).toEqual([`POST ${REVIEW_URL}`]));

    act(() => answer.release());
    await waitFor(() => expect(changeList()).toBeInTheDocument());
    expect(screen.queryByRole("heading", { level: 2, name: "Household" })).toBeNull();
    expect(screen.getByRole("article", { name: "Joint Checking" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Fact finder pages" })).toBeInTheDocument();
    expect(reviewButton()).toBeEnabled();
  });

  it("opens on the change list when the fact finder already has one", () => {
    renderScreen(reviewedAt(ready()));
    expect(changeList()).toBeInTheDocument();
  });

  it("Back to fact finder keeps the ticks: Review changes → shows the same list again without reviewing", async () => {
    const user = userEvent.setup();
    const net = stubServer(reviewedAt(ready()));
    renderScreen(reviewedAt(ready()));

    await user.click(screen.getByRole("checkbox", { name: "Include Value" }));
    await user.click(screen.getByRole("button", { name: "Back to fact finder" }));
    expect(changeList()).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Household" })).toBeInTheDocument();

    await user.click(reviewButton());
    expect(changeList()).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Value" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Name" })).toBeChecked();
    expect(net.reviews()).toBe(0);
  });

  it("the rail marks no page while the list shows, and the page again on Back", async () => {
    const user = userEvent.setup();
    renderScreen(reviewedAt(ready()));
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    expect(rail.querySelector("[aria-current]")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to fact finder" }));
    expect(within(rail).getByRole("button", { name: /^Household/ })).toHaveAttribute("aria-current", "page");
  });

  it("picking a page in the rail returns to the fact finder on that page", async () => {
    const user = userEvent.setup();
    renderScreen(reviewedAt(ready()));
    expect(changeList()).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    await user.click(within(rail).getByRole("button", { name: /^Income/ }));
    expect(changeList()).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Income" })).toBeInTheDocument();
  });

  it("an edit drops the change set: the button waits for the save, then builds a new list", async () => {
    const user = userEvent.setup();
    const net = stubServer(reviewedAt(ready()));
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("button", { name: "Back to fact finder" }));

    await user.type(screen.getAllByRole("textbox", { name: "First name" })[1], "Laura{Enter}");
    expect(reviewButton()).toBeDisabled();
    expect(reviewButton()).toHaveAccessibleDescription("Wait for your edits to save.");

    await waitFor(() => expect(reviewButton()).toBeEnabled());
    expect(net.log).toEqual([`PATCH ${FF_URL}`]);
    await user.click(reviewButton());
    await waitFor(() => expect(changeList()).toBeInTheDocument());
    expect(net.reviews()).toBe(1);
  });

  it("a review that lands while an edit is still saving says review again, not the list it built", async () => {
    const user = userEvent.setup();
    const answer = held((s) => json(200, { factFinder: reviewedAt(s) }));
    stubServer(ready(), answer.reply, { holdSaves: true });
    renderScreen(ready());

    await user.click(reviewButton());
    await user.type(screen.getAllByRole("textbox", { name: "First name" })[1], "Laura{Enter}");
    act(() => answer.release());

    await waitFor(() => expect(screen.getByText("The fact finder changed — review again.")).toBeInTheDocument());
    expect(screen.queryByRole("article", { name: "Joint Checking" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review again" })).toBeDisabled();
    expect(reviewButton()).toHaveAccessibleDescription("Wait for your edits to save.");
  });

  describe("Save to plan", () => {
    const saveButton = () => screen.getByRole("button", { name: /^(Save to plan|Saving…)$/ });

    it("posts the list's version and the ticks, Saving… meanwhile, and leaves the list when the save lands", async () => {
      const user = userEvent.setup();
      const answer = held((s) => json(200, { factFinder: { ...s, version: s.version + 1 } }));
      const bodies: SaveBody[] = [];
      const net = stubServer(reviewedAt(ready()), undefined, {
        save: (s, body) => {
          bodies.push(body);
          return answer.reply(s);
        },
      });
      renderScreen(reviewedAt(ready()));

      await user.click(screen.getByRole("checkbox", { name: "Include Value" }));
      await user.click(saveButton());
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toEqual({ changeSetVersion: 1, ticks: { "c1/account": { name: true, value: false } } });

      act(() => answer.release());
      await waitFor(() => expect(changeList()).toBeNull());
      expect(net.reviews()).toBe(0);
    });

    it("a refused line stays on the list, ringed with its reason", async () => {
      const user = userEvent.setup();
      stubServer(reviewedAt(ready()), undefined, {
        save: () => json(422, { error: "Joint Checking: Value must be a number.", lineId: "c1/account" }) as Response,
      });
      renderScreen(reviewedAt(ready()));
      await user.click(saveButton());
      const joint = await screen.findByRole("article", { name: "Joint Checking" });
      expect(within(joint).getByRole("alert")).toHaveTextContent("Joint Checking: Value must be a number.");
      expect(changeList()).toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });

    it("a stale list shows its reason with Review again, which builds the list again", async () => {
      const user = userEvent.setup();
      const stale = (s: FactFinderState): FactFinderState => {
        const { changeSet, ...rest } = s;
        void changeSet;
        return { ...rest, version: s.version + 1 };
      };
      const net = stubServer(reviewedAt(ready()), undefined, {
        save: (s) => json(409, { error: SAVE_STALE_MESSAGE, factFinder: stale(s) }) as Response,
      });
      renderScreen(reviewedAt(ready()));
      await user.click(saveButton());
      await waitFor(() => expect(screen.getByText(SAVE_STALE_MESSAGE)).toBeInTheDocument());
      expect(screen.queryByRole("article", { name: "Joint Checking" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Review again" }));
      await waitFor(() => expect(changeList()).toBeInTheDocument());
      expect(net.reviews()).toBe(1);
      expect(screen.queryByText(SAVE_STALE_MESSAGE)).toBeNull();
    });

    it.each([
      { what: "the same lines: the unticked Value stays unticked", value: 41233, ticked: false },
      { what: "a new Value: it comes back at its default", value: 42000, ticked: true },
    ])("a record changed since the review → Review again rebuilds the list; $what, and the next Save posts that", async ({ value, ticked }) => {
      const user = userEvent.setup();
      const bodies: SaveBody[] = [];
      const changed = "“Fidelity IRA” changed since you reviewed — review again.";
      const rebuilt = (s: FactFinderState): FactFinderState => {
        const next = reviewedAt(s);
        const [joint, ...rest] = next.changeSet!.lines;
        const fields = joint.fields.map((f) => (f.key === "value" ? { ...f, next: value, shown: { next: `$${value}` } } : f));
        return { ...next, changeSet: { ...next.changeSet!, lines: [{ ...joint, fields }, ...rest] } };
      };
      const net = stubServer(reviewedAt(ready()), (s) => json(200, { factFinder: rebuilt(s) }), {
        save: (_s, body) => {
          bodies.push(body);
          return json(409, { error: changed });
        },
      });
      renderScreen(reviewedAt(ready()));

      await user.click(screen.getByRole("checkbox", { name: "Include Value" }));
      await user.click(saveButton());
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(changed));
      await user.click(screen.getByRole("button", { name: "Review again" }));
      await waitFor(() => expect(net.reviews()).toBe(1));
      await waitFor(() => expect(screen.queryByText(changed)).toBeNull());

      expect((screen.getByRole("checkbox", { name: "Include Value" }) as HTMLInputElement).checked).toBe(ticked);
      expect(screen.getByRole("checkbox", { name: "Include Name" })).toBeChecked();
      await user.click(saveButton());
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toEqual({ changeSetVersion: 2, ticks: { "c1/account": { name: true, value: ticked } } });
    });

    it("unticking a line shows in place that it is left out, and Save waits when nothing is left to write", async () => {
      const user = userEvent.setup();
      renderScreen(reviewedAt(ready()));
      await user.click(screen.getByRole("checkbox", { name: "Include all of Joint Checking" }));
      expect(within(screen.getByRole("article", { name: "Joint Checking" })).getByText("Left out — Nothing ticked.")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      expect(saveButton()).toHaveAccessibleDescription("There's nothing to save — every row is unticked or left out.");
    });

    it("waits while a document is being read — its rows would land on a saved import — and opens up once the read is done", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        const start = reviewedAt(reading());
        const server = structuredClone(start);
        stubServer(server);
        renderScreen(start);
        expect(saveButton()).toBeDisabled();
        expect(saveButton()).toHaveAccessibleDescription("Wait for the documents to finish reading.");

        // The read ends; the screen's next check on it (every 5 s) finds that.
        Object.assign(server, { version: server.version + 1, readings: { f1: READ } });
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(saveButton()).toBeEnabled();
        expect(saveButton()).toHaveAccessibleDescription("");
      } finally {
        vi.useRealTimers();
      }
    });

    it("there is no Save to plan while an edit is waiting to save", async () => {
      const user = userEvent.setup();
      stubServer(reviewedAt(ready()), undefined, { holdSaves: true });
      renderScreen(reviewedAt(ready()));
      await user.click(screen.getByRole("button", { name: "Back to fact finder" }));
      await user.type(screen.getAllByRole("textbox", { name: "First name" })[1], "Laura{Enter}");
      await user.click(reviewButton());
      expect(screen.queryByRole("button", { name: "Save to plan" })).toBeNull();
    });
  });

  it("a chat answer that edits nothing leaves the list in place, ticks and all", async () => {
    const user = userEvent.setup();
    const net = stubServer(reviewedAt(ready()));
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("checkbox", { name: "Include Value" }));
    await user.click(screen.getByRole("button", { name: "Documents & chat" }));
    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "What's still missing?{Enter}");

    expect(await screen.findByText(REPLY.text)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Joint Checking" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Value" })).not.toBeChecked();
    expect(screen.queryByText("The fact finder changed — review again.")).toBeNull();
    expect(net.reviews()).toBe(0);
  });

  it("when the change set goes while the list is open (a chat reply), says the fact finder changed and offers to review again", async () => {
    const user = userEvent.setup();
    const net = stubServer(reviewedAt(ready()), undefined, { turnEdits: true });
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("button", { name: "Documents & chat" }));
    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Joint Checking is 13,000 now{Enter}");

    await waitFor(() => expect(screen.getByText("The fact finder changed — review again.")).toBeInTheDocument());
    expect(screen.queryByRole("article", { name: "Joint Checking" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Review again" }));
    await waitFor(() => expect(screen.getByRole("article", { name: "Joint Checking" })).toBeInTheDocument());
    expect(net.reviews()).toBe(1);
  });

  it("Fix in fact finder opens the cell's page, centres the cell (clear of the sticky row actions), focuses it and rings it until focus moves on", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderScreen(reviewedAt(ready()));
      await user.click(screen.getByRole("button", { name: "Fix in fact finder" }));

      expect(changeList()).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeInTheDocument();
      const name = within(screen.getByRole("table", { name: "Cash Accounts" })).getByRole("textbox", { name: "Account name" });
      const cell = name.closest("[data-cell]");
      expect(name).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "center", inline: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(cell);
      expect(cell).toHaveAttribute("data-cell", "c1:accountName");
      // Focus after a click shows no focus ring of its own, so the cell carries one.
      expect(cell).toHaveClass("outline-2", "outline-accent");

      await user.click(screen.getByRole("heading", { level: 2, name: "Accounts" }));
      expect(cell).not.toHaveClass("outline-2");
      expect(cell).not.toHaveClass("outline-accent");
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("Fix in fact finder centres the cell in the part of its table the sticky row actions leave visible", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    const rect = (left: number, width: number) => DOMRect.fromRect({ x: left, y: 0, width, height: 20 });
    // As the browser laid it out at 1280 px: the scroller 393–871, the row's actions from 635, the cell 544–720.
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.matches("[data-row-actions]")) return rect(635, 236);
      if (this.matches('[data-cell="c1:accountName"]')) return rect(544, 176);
      if (this.firstElementChild?.tagName === "TABLE") return rect(393, 478);
      return rect(0, 0);
    });
    const scrollLeft = vi.spyOn(Element.prototype, "scrollLeft", "set");
    try {
      renderScreen(reviewedAt(ready()));
      await user.click(screen.getByRole("button", { name: "Fix in fact finder" }));

      // Midway between the scroller's left (393) and the actions' (635) is 514; the cell's centre (632) moves there.
      expect(scrollLeft).toHaveBeenCalledExactlyOnceWith(118);
      expect(scrollLeft.mock.contexts[0]).toBe(screen.getByRole("table", { name: "Cash Accounts" }).parentElement);
    } finally {
      rects.mockRestore();
      scrollLeft.mockRestore();
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("shows a refusal under the button, and Dismiss clears it", async () => {
    const user = userEvent.setup();
    stubServer(ready(), () => json(409, { error: REVIEW_READING_MESSAGE }));
    renderScreen(ready());

    await user.click(reviewButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(REVIEW_READING_MESSAGE);
    expect(changeList()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a saved (closed) import", () => {
  const changeList = () => screen.queryByRole("heading", { level: 2, name: "Changes to the plan" });
  const closedAt = (s: FactFinderState): FactFinderState => ({
    ...s,
    version: s.version + 1,
    closed: {
      at: "2026-10-14T12:00:00.000Z",
      by: "user_1",
      saved: [{ lineId: "c1/account", rowId: "c1", target: "account", recordId: "acct-9", label: "Joint Checking" }],
      leftOut: [{ lineId: "x1/account", rowId: "x1", label: "Old IRA", reason: "Needs Name." }],
    },
  });
  const OTHER_NAMES = [
    "Review changes →",
    "Save to plan",
    "Documents & chat",
  ];

  it("opens on the closed view: no review, no chat or documents, and not one request", () => {
    stubServer(ready());
    renderScreen(closedAt(reviewedAt(ready())));
    expect(screen.getByRole("status")).toHaveTextContent(/Saved to the plan on October 1[45], 2026 — 1 saved, 1 left out/);
    OTHER_NAMES.forEach((name) => expect(screen.queryByRole("button", { name })).toBeNull());
    expect(screen.queryByRole("article", { name: "Joint Checking" })).toBeNull();
    expect(screen.getByRole("status")).not.toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the fact finder under the summary, read-only, and the rail still switches pages", async () => {
    const user = userEvent.setup();
    stubServer(ready());
    renderScreen(closedAt(ready()));
    const rail = screen.getByRole("navigation", { name: "Fact finder pages" });
    const first = screen.getAllByRole("textbox", { name: "First name" })[0];
    expect(first).toBeDisabled();
    expect(first).toHaveValue("Mark");
    await user.click(within(rail).getByRole("button", { name: /^Accounts/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox").every((box) => box.matches(":disabled"))).toBe(true);
    // Every editing button is disabled; the view-only disclosures (holdings) stay usable.
    const editing = screen.getAllByRole("button").filter((b) => b.closest("fieldset") && !b.hasAttribute("aria-expanded"));
    expect(editing.every((b) => b.matches(":disabled"))).toBe(true);
    // …and look it: a disabled Add row or Merge doesn't pass for one that works.
    expect(screen.getAllByRole("textbox")[0].closest("fieldset")).toHaveClass("[&_button:disabled]:opacity-50");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets the advisor open an account's holdings on the closed screen, while editing stays off", async () => {
    const user = userEvent.setup();
    stubServer(ready());
    const base = closedAt(ready());
    const account: FFRow = {
      id: "t1",
      cells: { accountName: { value: "Joint Brokerage", by: "advisor", pinned: true } },
      sourceFileIds: [],
      holdings: [{ id: "h1", ticker: "VTI", name: "Vanguard Total Stock Market", shares: 100, price: 100, marketValue: 10000, costBasis: null, by: "document" }],
    };
    renderScreen({ ...base, sections: { ...base.sections, taxable: [account] } });
    await user.click(within(screen.getByRole("navigation", { name: "Fact finder pages" })).getByRole("button", { name: /^Accounts/ }));
    const toggle = screen.getByRole("button", { name: "1 holding in Joint Brokerage" });
    expect(toggle).not.toBeDisabled();
    // fireEvent, not user.click: user-event treats anything in a disabled fieldset as disabled, a browser doesn't for a non-form control.
    fireEvent.click(toggle);
    const table = screen.getByRole("table", { name: "Holdings in Joint Brokerage" });
    expect(within(table).getByText("VTI")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The holdings table is read-only too: nothing in it can be edited.
    expect(within(table).queryAllByRole("textbox").every((box) => box.matches(":disabled"))).toBe(true);
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.queryByRole("table", { name: "Holdings in Joint Brokerage" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes the screen when the save lands, with no further request", async () => {
    const user = userEvent.setup();
    stubServer(reviewedAt(ready()), undefined, { save: (s) => json(200, { factFinder: closedAt(s) }) as Response });
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("button", { name: "Save to plan" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved to the plan on October 1[45], 2026/));
    // The Save button is gone: focus moves to the summary.
    expect(screen.getByRole("status")).toHaveFocus();
    expect(changeList()).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes →" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([SAVE_URL]);
  });

  it("sends no edit typed while the save was in flight once the save closes the import", async () => {
    const user = userEvent.setup();
    let land: (res: Response) => void = () => {};
    const { log } = stubServer(reviewedAt(ready()), undefined, {
      save: () => new Promise<Response>((resolve) => (land = resolve)),
    });
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("button", { name: "Save to plan" }));
    // Show the page again behind the list and type, while the save is still out .
    await user.click(screen.getByRole("button", { name: "Back to fact finder" }));
    await user.type(screen.getAllByRole("textbox", { name: "First name" })[0], "x");
    await user.tab(); // the edit joins the queue; its timed send hasn't fired yet
    await act(async () => land(json(200, { factFinder: closedAt(reviewedAt(ready())) }) as Response));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved to the plan/));
    expect(log.filter((l) => l.startsWith("PATCH"))).toHaveLength(0);
  });

  it("shows the closed view when the save is refused because another tab already saved", async () => {
    const user = userEvent.setup();
    stubServer(reviewedAt(ready()), undefined, {
      save: (s) => json(409, { error: "This import is saved to the plan — start a new import to change it.", factFinder: closedAt(s) }) as Response,
    });
    renderScreen(reviewedAt(ready()));
    await user.click(screen.getByRole("button", { name: "Save to plan" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved to the plan on October 1[45], 2026/));
    expect(changeList()).toBeNull();
  });

  it("shows the closed view when an edit is refused because another tab saved — and the edit isn't sent again", async () => {
    const user = userEvent.setup();
    let patches = 0;
    // The first edit is refused with the saved fact finder; a second send would wait here for ever.
    const { log } = stubServer(ready(), undefined, {
      patch: (s) =>
        patches++ === 0
          ? (json(409, { error: "This import is saved to the plan — start a new import to change it.", factFinder: closedAt(s) }) as Response)
          : new Promise<Response>(() => {}),
    });
    renderScreen(ready());
    const first = screen.getAllByRole("textbox", { name: "First name" })[0];
    await user.clear(first);
    await user.type(first, "Marcus");
    await user.tab();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved to the plan on October 1[45], 2026/));
    expect(screen.getAllByRole("textbox", { name: "First name" })[0]).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(log.filter((l) => l.startsWith("PATCH"))).toHaveLength(1);
  });
});
