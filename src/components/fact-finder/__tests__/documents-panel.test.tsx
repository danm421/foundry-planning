// @vitest-environment jsdom
// src/components/fact-finder/__tests__/documents-panel.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { READ_BUSY_MESSAGE, type ReadFrame } from "@/lib/fact-finder/api-types";
import { STALE_READING_MS } from "@/lib/fact-finder/reading-status";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFFileReading, FFRow } from "@/lib/fact-finder/types";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { DocumentsPanel, type Documents } from "../documents-panel";
import { FactFinderScreen } from "../fact-finder-screen";
import type { FFScreenFile } from "../screen-types";

// The real zone uploads over XMLHttpRequest; this one reports an upload or a removal on a click.
// Its Add copies a client upload the way the real one does (upload-zone-client-uploads.test.tsx): onUploaded with the copy's id.
vi.mock("@/components/import/upload-zone", () => ({
  default: ({
    initialFiles,
    onUploaded,
    onRemoved,
    clientUploads,
  }: {
    initialFiles?: { serverFileId: string; name: string; documentType: string }[];
    onUploaded?: (info: { serverFileId: string; name: string; deduped: boolean }) => void;
    onRemoved?: (serverFileId: string) => void;
    clientUploads?: IntakeDocumentView[];
  }) => (
    <div>
      <p>Upload list: {initialFiles?.map((f) => `${f.serverFileId} ${f.name} (${f.documentType})`).join("; ")}</p>
      <button type="button" onClick={() => onUploaded?.({ serverFileId: "f3", name: "fidelity-401k.pdf", deduped: false })}>
        Upload fidelity-401k.pdf
      </button>
      {clientUploads?.map((doc) => (
        <button key={doc.id} type="button" onClick={() => onUploaded?.({ serverFileId: "f4", name: doc.filename, deduped: false })}>
          Add {doc.filename}
        </button>
      ))}
      <button type="button" onClick={() => onRemoved?.("f2")}>
        Remove schwab-june.pdf
      </button>
    </div>
  ),
}));

const READ_URL = "/api/clients/c1/imports/i1/fact-finder/read";
const FF_URL = "/api/clients/c1/imports/i1/fact-finder";
const AT = "2026-10-13T09:00:00.000Z";

const FILES: FFScreenFile[] = [
  { id: "f1", name: "hendricks-fact-finder.pdf", documentType: "fact_finder" },
  { id: "f2", name: "schwab-june.pdf", documentType: "auto" },
];
const DONE: FFFileReading = { status: "done", reader: "section", startedAt: AT, finishedAt: AT, rows: 3 };
const withReadings = (readings: FactFinderState["readings"], version = 0): FactFinderState => ({
  ...emptyFactFinderState(),
  version,
  readings,
});

const sse = (f: ReadFrame) => `data: ${JSON.stringify(f)}\n\n`;
const fileFrame = (fileId: string, status: "reading" | "done" | "failed", extra: object = {}): ReadFrame => ({
  type: "file",
  fileId,
  fileName: `${fileId}.pdf`,
  status,
  ...extra,
});
const finished = (summary = "Read 1 document."): ReadFrame => ({ type: "done", summary, caveats: [], version: 2 });

/** A read response whose body the test writes, chunk by chunk, and closes when it chooses. */
function liveStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    write: (...frames: ReadFrame[]) => controller.enqueue(encoder.encode(frames.map(sse).join(""))),
    close: () => controller.close(),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** POST …/read answers with the queued responses in turn; GET …/fact-finder with `fresh()`. */
function stubFetch(
  reads: Response[],
  fresh: () => FactFinderState | Promise<FactFinderState> = () => emptyFactFinderState(),
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === READ_URL && init?.method === "POST") {
      const next = reads.shift();
      if (!next) throw new Error("no read response queued");
      return next;
    }
    if (url === FF_URL && !init?.method) return jsonResponse(200, { factFinder: await fresh() });
    throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const count = (url: string, method?: string) =>
    fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === method).length;
  return { reads: () => count(READ_URL, "POST"), gets: () => count(FF_URL) };
}

function renderScreen(state: FactFinderState, files: FFScreenFile[] = FILES, clientUploads?: IntakeDocumentView[]) {
  return render(
    <FactFinderScreen
      clientId="c1"
      importId="i1"
      initialState={state}
      initialFiles={files}
      entities={[]}
      hasCoClient
      clientUploads={clientUploads}
    />,
  );
}

const panel = () => screen.getByRole("complementary", { name: "Documents & chat" });
const review = () => screen.getByRole("button", { name: "Review changes →" });
/** The progress line naming this document. */
const line = (name: string) => within(screen.getByRole("list", { name: "Reading progress" })).getByText(name).closest("li");
/** Lets the stream's chunks and the replies they trigger land, advancing fake time by `ms`. */
const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reading on open", () => {
  it("reads when a document still needs it: the panel opens, the lines follow the read, and Review waits", async () => {
    const stream = liveStream();
    const net = stubFetch([stream.response], () => withReadings({ f1: DONE, f2: { ...DONE, rows: 5 } }, 2));
    renderScreen(withReadings({ f1: DONE }));

    expect(panel()).toBeInTheDocument();
    expect(net.reads()).toBe(1);
    expect(review()).toHaveAccessibleDescription("Wait for the documents to finish reading.");
    expect(line("hendricks-fact-finder.pdf")).toHaveTextContent("Read · 3 rows");
    expect(line("schwab-june.pdf")).toHaveTextContent("Waiting to read");

    act(() => stream.write(fileFrame("f2", "reading")));
    await waitFor(() => expect(line("schwab-june.pdf")).toHaveTextContent("Reading…"));

    act(() => {
      stream.write(fileFrame("f2", "done", { reader: "statement", rows: 5 }), finished());
      stream.close();
    });
    await waitFor(() => expect(review()).toBeEnabled());
    expect(line("schwab-june.pdf")).toHaveTextContent("Read · 5 rows");
    expect(net.gets()).toBe(1);
  });

  it("doesn't read when every document has been read", () => {
    const net = stubFetch([]);
    renderScreen(withReadings({ f1: DONE, f2: DONE }));

    expect(screen.getByRole("button", { name: "Documents & chat" })).toHaveAttribute("aria-expanded", "false");
    expect(net.reads()).toBe(0);
  });

  it("reads a document abandoned mid-read", () => {
    const net = stubFetch([liveStream().response]);
    const abandoned: FFFileReading = { status: "reading", startedAt: new Date(Date.now() - STALE_READING_MS - 1000).toISOString() };
    renderScreen(withReadings({ f1: DONE, f2: abandoned }));

    expect(net.reads()).toBe(1);
  });

  it("a failed document opens the panel without reading: it waits for its Retry, so opening the screen doesn't fail it again", async () => {
    const net = stubFetch([liveStream().response]);
    renderScreen(withReadings({ f1: DONE, f2: { status: "failed", startedAt: AT, reason: "Couldn't read this document — try again." } }));

    expect(panel()).toBeInTheDocument();
    expect(line("schwab-june.pdf")).toHaveTextContent("Couldn't read");
    expect(net.reads()).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Retry reading schwab-june.pdf" }));
    expect(net.reads()).toBe(1);
  });

  it("shows a refused read's message with a Retry that reads again", async () => {
    const net = stubFetch([jsonResponse(409, { error: READ_BUSY_MESSAGE }), liveStream().response]);
    renderScreen(withReadings({ f1: DONE }));

    const alert = await within(panel()).findByRole("alert");
    expect(alert).toHaveTextContent(READ_BUSY_MESSAGE);
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(net.reads()).toBe(2);
    expect(within(panel()).queryByRole("alert")).toBeNull();
  });

  it("offers Retry on a document the read couldn't finish, and Retry reads again", async () => {
    const stream = liveStream();
    const net = stubFetch([stream.response, liveStream().response]);
    renderScreen(withReadings({ f1: DONE }));

    act(() => {
      stream.write(
        fileFrame("f2", "reading"),
        fileFrame("f2", "failed", { error: "Stopped before this file was read." }),
        finished("Couldn't read 1 document — Retry it."),
      );
      stream.close();
    });
    await waitFor(() => expect(line("schwab-june.pdf")).toHaveTextContent("Couldn't read"));
    expect(line("schwab-june.pdf")).toHaveTextContent("Stopped before this file was read.");

    await userEvent.click(screen.getByRole("button", { name: "Retry reading schwab-june.pdf" }));
    expect(net.reads()).toBe(2);
  });
});

describe("progress lines", () => {
  const docs = (files: FFScreenFile[], lines: Documents["read"]["lines"] = {}): Documents => ({
    files,
    fileName: (id) => files.find((f) => f.id === id)?.name,
    read: { lines, running: false, error: null, start: vi.fn() },
    readsOnOpen: false,
    uploaded: vi.fn(),
    removed: vi.fn(),
  });

  it("shows each document's state from the live read, else from the fact finder", async () => {
    const state = withReadings({
      a: { status: "reading", startedAt: new Date().toISOString() },
      b: { status: "done", startedAt: AT, rows: 0 },
      c: { status: "failed", startedAt: AT, reason: "Couldn't read this document — try again." },
      e: { status: "done", startedAt: AT, rows: 1 },
      f: { status: "reading", startedAt: "2026-01-01T00:00:00.000Z" },
    });
    const files = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: `${id}.pdf`, documentType: "auto" }));
    const props = docs(files, { e: fileFrame("e", "reading") as Documents["read"]["lines"][string] });
    render(<DocumentsPanel clientId="c1" importId="i1" docs={props} state={state} />);

    expect(line("a.pdf")).toHaveTextContent("Reading…");
    expect(line("b.pdf")).toHaveTextContent("Read · nothing found");
    expect(line("c.pdf")).toHaveTextContent("Couldn't read");
    expect(line("c.pdf")).toHaveTextContent("Couldn't read this document — try again.");
    expect(line("d.pdf")).toHaveTextContent("Waiting to read");
    expect(line("e.pdf")).toHaveTextContent("Reading…");
    expect(line("f.pdf")).toHaveTextContent("Waiting to read");
    expect(screen.getAllByRole("button", { name: /^Retry/ })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Retry reading c.pdf" }));
    expect(props.read.start).toHaveBeenCalledTimes(1);
  });

  it("hands the upload zone the documents it already has", () => {
    render(<DocumentsPanel clientId="c1" importId="i1" docs={docs(FILES)} state={emptyFactFinderState()} />);
    expect(screen.getByText(/^Upload list:/)).toHaveTextContent(
      "Upload list: f1 hendricks-fact-finder.pdf (fact_finder); f2 schwab-june.pdf (auto)",
    );
  });
});

describe("uploads", () => {
  it("adds an upload to the list at once and reads it 1.5 s after the last upload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stream = liveStream();
    const net = stubFetch([stream.response]);
    renderScreen(withReadings({ f1: DONE, f2: DONE }));
    fireEvent.click(screen.getByRole("button", { name: "Documents & chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Upload fidelity-401k.pdf" }));
    expect(line("fidelity-401k.pdf")).toHaveTextContent("Waiting to read");
    await elapse(1000);
    fireEvent.click(screen.getByRole("button", { name: "Upload fidelity-401k.pdf" }));
    await elapse(1499);
    expect(net.reads()).toBe(0);
    expect(screen.getAllByText("fidelity-401k.pdf")).toHaveLength(1);

    await elapse(1);
    expect(net.reads()).toBe(1);
    expect(review()).toHaveAccessibleDescription("Wait for the documents to finish reading.");
  });

  it("names an uploaded document as the source of the values read from it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stream = liveStream();
    const cash: FFRow = {
      id: "c1",
      cells: { accountName: { value: "Rollover IRA cash", confidence: 0.95, by: "document", source: { fileId: "f3" } } },
      sourceFileIds: ["f3"],
    };
    const fresh = withReadings({ f1: DONE, f2: DONE, f3: DONE }, 2);
    stubFetch([stream.response], () => ({ ...fresh, sections: { ...fresh.sections, cash: [cash] } }));
    renderScreen(withReadings({ f1: DONE, f2: DONE }));
    fireEvent.click(screen.getByRole("button", { name: "Documents & chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Upload fidelity-401k.pdf" }));
    await elapse(1500);
    act(() => {
      stream.write(fileFrame("f3", "reading"), fileFrame("f3", "done", { rows: 1 }), finished());
      stream.close();
    });
    await elapse(0);

    fireEvent.click(screen.getByRole("button", { name: /^Accounts/ }));
    const table = screen.getByRole("table", { name: "Cash Accounts" });
    expect(within(table).getByRole("tooltip")).toHaveTextContent("From fidelity-401k.pdf");
  });

  it("offers the client's Data Collection uploads, and reads one the advisor adds like any upload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const net = stubFetch([liveStream().response]);
    const statement: IntakeDocumentView = {
      id: "11111111-1111-4111-8111-111111111111",
      filename: "brokerage-statement.pdf",
      docType: "statement",
      sizeBytes: 245_760,
      uploadedAt: "2026-08-01T12:00:00.000Z",
    };
    renderScreen(withReadings({ f1: DONE, f2: DONE }), FILES, [statement]);
    fireEvent.click(screen.getByRole("button", { name: "Documents & chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Add brokerage-statement.pdf" }));
    expect(line("brokerage-statement.pdf")).toHaveTextContent("Waiting to read");
    await elapse(1500);
    expect(net.reads()).toBe(1);
  });

  it("drops a removed document's line", () => {
    stubFetch([]);
    renderScreen(withReadings({ f1: DONE, f2: DONE }));
    fireEvent.click(screen.getByRole("button", { name: "Documents & chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove schwab-june.pdf" }));
    expect(within(screen.getByRole("list", { name: "Reading progress" })).queryByText("schwab-june.pdf")).toBeNull();
    expect(line("hendricks-fact-finder.pdf")).toBeInTheDocument();
  });
});

describe("refreshing the screen as documents finish", () => {
  it("fetches the fact finder at most every 2 s while files finish, and at once when the read is done", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stream = liveStream();
    const cash: FFRow = {
      id: "c1",
      cells: { accountName: { value: "Joint Checking", confidence: 0.95, by: "document", source: { fileId: "f1" } } },
      sourceFileIds: ["f1"],
    };
    const fresh = withReadings({ f1: DONE }, 1);
    const net = stubFetch([stream.response], () => ({ ...fresh, sections: { ...fresh.sections, cash: [cash] } }));
    renderScreen(emptyFactFinderState());
    const accounts = () => screen.getByRole("button", { name: /^Accounts/ });
    expect(accounts()).toHaveAccessibleName("Accounts");

    act(() => stream.write(fileFrame("f1", "reading"), fileFrame("f2", "reading"), fileFrame("f1", "done")));
    await elapse(1000);
    expect(net.gets()).toBe(0);

    act(() => stream.write(fileFrame("f2", "done")));
    await elapse(999);
    expect(net.gets()).toBe(0);
    await elapse(1);
    expect(net.gets()).toBe(1);
    expect(accounts()).toHaveAccessibleName("Accounts, has values");

    act(() => {
      stream.write(finished());
      stream.close();
    });
    await elapse(0);
    expect(net.gets()).toBe(2);
    await elapse(5000);
    expect(net.gets()).toBe(2);
  });
});

describe("a read started elsewhere", () => {
  const TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] as const;
  /** Started a moment ago by another tab, or by this screen before a reload. */
  const readingNow = (): FFFileReading => ({ status: "reading", startedAt: new Date().toISOString() });
  /** Answers each GET with the next state; the last one repeats. */
  const inTurn = (...states: FactFinderState[]) => {
    let calls = 0;
    return () => states[Math.min(calls++, states.length - 1)];
  };

  it("checks on it every 5 s and fills the screen in as it goes, until nothing is reading", async () => {
    vi.useFakeTimers({ toFake: [...TIMERS] });
    const elsewhere = withReadings({ f1: DONE, f2: readingNow() }, 1);
    const net = stubFetch([], inTurn({ ...elsewhere, version: 2 }, withReadings({ f1: DONE, f2: { ...DONE, rows: 5 } }, 3)));
    renderScreen(elsewhere);

    expect(panel()).toBeInTheDocument();
    expect(line("schwab-june.pdf")).toHaveTextContent("Reading…");
    await elapse(4999);
    expect(net.gets()).toBe(0);
    await elapse(1);
    expect(net.gets()).toBe(1);
    expect(review()).toHaveAccessibleDescription("Wait for the documents to finish reading.");

    await elapse(5000);
    expect(net.gets()).toBe(2);
    expect(line("schwab-june.pdf")).toHaveTextContent("Read · 5 rows");
    expect(review()).toBeEnabled();

    await elapse(20000);
    expect(net.gets()).toBe(2);
    expect(net.reads()).toBe(0);
  });

  it("doesn't check while the screen's own read is streaming; that read refreshes the screen itself", async () => {
    vi.useFakeTimers({ toFake: [...TIMERS] });
    const stream = liveStream();
    const net = stubFetch(
      [stream.response],
      inTurn(withReadings({ f1: DONE, f2: readingNow() }, 1), withReadings({ f1: DONE, f2: DONE }, 2)),
    );
    renderScreen(emptyFactFinderState());

    act(() => stream.write(fileFrame("f1", "reading"), fileFrame("f1", "done")));
    await elapse(2000);
    expect(net.gets()).toBe(1);
    expect(line("schwab-june.pdf")).toHaveTextContent("Reading…");

    await elapse(15000);
    expect(net.gets()).toBe(1);

    act(() => {
      stream.write(fileFrame("f2", "done"), finished());
      stream.close();
    });
    await elapse(0);
    expect(net.gets()).toBe(2);
    await elapse(10000);
    expect(net.gets()).toBe(2);
  });

  it("keeps checking on the other read when its own read is refused because of it", async () => {
    vi.useFakeTimers({ toFake: [...TIMERS] });
    const net = stubFetch([jsonResponse(409, { error: READ_BUSY_MESSAGE })], () => withReadings({ f1: DONE, f2: DONE }, 1));
    renderScreen(withReadings({ f1: readingNow() }));

    await elapse(0);
    expect(net.reads()).toBe(1);
    expect(within(panel()).getByRole("alert")).toHaveTextContent(READ_BUSY_MESSAGE);
    await elapse(5000);
    expect(net.gets()).toBe(1);
    expect(line("hendricks-fact-finder.pdf")).toHaveTextContent("Read · 3 rows");
    expect(line("schwab-june.pdf")).toHaveTextContent("Read · 3 rows");

    await elapse(10000);
    expect(net.gets()).toBe(1);
  });

  it("never sends a check while the last one is still waiting for its answer", async () => {
    vi.useFakeTimers({ toFake: [...TIMERS] });
    const elsewhere = withReadings({ f1: DONE, f2: readingNow() }, 1);
    let answer: (state: FactFinderState) => void = () => {};
    const net = stubFetch([], () => new Promise<FactFinderState>((resolve) => (answer = resolve)));
    renderScreen(elsewhere);

    await elapse(5000);
    expect(net.gets()).toBe(1);
    await elapse(15000);
    expect(net.gets()).toBe(1);

    answer({ ...elsewhere, version: 2 });
    await elapse(5000);
    expect(net.gets()).toBe(2);
  });

  it("stops checking once that reading has gone on too long to still be running", async () => {
    vi.useFakeTimers({ toFake: [...TIMERS, "Date"], now: new Date(AT) });
    const abandoned = withReadings(
      { f1: DONE, f2: { status: "reading", startedAt: new Date(Date.parse(AT) - STALE_READING_MS + 7000).toISOString() } },
      1,
    );
    const net = stubFetch([], () => abandoned);
    renderScreen(abandoned);

    await elapse(5000);
    expect(net.gets()).toBe(1);
    expect(line("schwab-june.pdf")).toHaveTextContent("Reading…");

    await elapse(5000);
    expect(net.gets()).toBe(2);
    expect(line("schwab-june.pdf")).toHaveTextContent("Waiting to read");
    expect(review()).toBeEnabled();

    await elapse(20000);
    expect(net.gets()).toBe(2);
    expect(net.reads()).toBe(0);
  });
});
