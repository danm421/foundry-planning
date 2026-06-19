// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ScenarioDrawerProvider,
} from "@/components/scenario/scenario-drawer-provider";
import { ForgeProvider } from "../forge-provider";
import { ForgePanel } from "../forge-panel";

/** Minimal streaming Response so the real useForgeStream.send() resolves. */
function makeStreamingResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(`data: {"type":"done"}\n\n`));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// Drive the URL scope. `current` is reassigned per render to simulate drift.
let currentSearch = "scenario=s1";
const currentPath = "/clients/c1/overview";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// Phase-0 server actions — mocked so the thread list doesn't hit the DB.
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
  resolveBaseScenarioId: vi.fn(async () => "base"),
}));

const IMPORT_RESULT = {
  importId: "imp_1",
  summary: { extract: { succeeded: 1, failed: 0 }, match: { exact: 1, fuzzy: 0, new: 0 } },
  warnings: [] as string[],
};

// Controllable so a test can hold the import open and assert the user bubble
// renders *before* the analysis resolves.
const importMocks = vi.hoisted(() => ({ runImport: vi.fn() }));

vi.mock("../use-forge-import", () => ({
  useForgeImport: () => ({
    status: "idle",
    errorMessage: null,
    runImport: importMocks.runImport,
    reset: vi.fn(),
  }),
}));

beforeEach(() => {
  currentSearch = "scenario=s1";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamingResponse()));
  importMocks.runImport.mockReset();
  importMocks.runImport.mockResolvedValue(IMPORT_RESULT);
});

function mountPanel() {
  return render(
    <ScenarioDrawerProvider>
      <ForgeProvider clientId="c1">
        <ForgePanel
          clientId="c1"
          clientName="Jane & John Smith"
          scenarioNames={{ s1: "Roth scenario", s2: "Delay SS to 70" }}
          forceOpenForTest
        />
      </ForgeProvider>
    </ScenarioDrawerProvider>,
  );
}

describe("ForgePanel", () => {
  it("renders the empty state and input (smoke)", async () => {
    mountPanel();
    expect(await screen.findByRole("textbox", { name: /ask forge/i })).toBeInTheDocument();
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument();
  });

  it("shows a humanized context line (client name, scenario, page — no raw IDs)", () => {
    mountPanel();
    expect(screen.getByTestId("chip-client").textContent).toBe("Jane & John Smith");
    expect(screen.getByTestId("chip-scenario").textContent).toContain("Roth scenario");
    // pathname mock is /clients/c1/overview → friendly page label
    expect(screen.getByTestId("chip-page").textContent).toBe("Overview");
  });

  it("shows an attached-file chip after choosing a file", async () => {
    mountPanel();
    const input = screen.getByTestId("forge-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });
    expect(screen.getByText("stmt.pdf")).toBeInTheDocument();
  });

  it("moves focus to the composer after choosing a file so the advisor can type immediately", async () => {
    mountPanel();
    const input = screen.getByTestId("forge-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });
    expect(screen.getByLabelText("Ask Forge")).toHaveFocus();
  });

  it("on send-with-file: shows the attachment in the thread, fires a chat turn with the import, and a review link", async () => {
    mountPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    // Review link (commit hand-off) appears.
    expect(await screen.findByTestId("forge-import-review")).toBeInTheDocument();

    // The chat turn fired with the import id and an empty (attachment-only) message.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const streamCall = calls.find((c) => String(c[0]).includes("/forge/stream"));
    expect(streamCall).toBeTruthy();
    const body = JSON.parse((streamCall![1] as { body: string }).body);
    expect(body.pendingImportId).toBe("imp_1");
    expect(body.message).toBe("");

    // The attachment shows in the conversation (user bubble chip).
    expect(screen.getAllByText(/stmt\.pdf/).length).toBeGreaterThan(0);
  });

  it("posts the user's message immediately, before the import analysis finishes", async () => {
    // Hold the import open so we can observe the moment between send and analysis.
    let release!: (v: typeof IMPORT_RESULT) => void;
    importMocks.runImport.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    mountPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "what is in this statement?" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    // Import is STILL pending: the user's turn (text + attachment chip) is
    // already in the thread, and the network turn has not fired yet.
    expect(screen.getByText("what is in this statement?")).toBeInTheDocument();
    expect(screen.getAllByText(/stmt\.pdf/).length).toBeGreaterThan(0);
    const callsMidImport = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(callsMidImport.find((c) => String(c[0]).includes("/forge/stream"))).toBeFalsy();

    // Releasing the import fires the chat turn — and the message is not duplicated.
    await act(async () => {
      release(IMPORT_RESULT);
    });
    expect(await screen.findByTestId("forge-import-review")).toBeInTheDocument();
    expect(screen.getAllByText("what is in this statement?")).toHaveLength(1);
  });

  it("clears the review link when starting a new chat", async () => {
    mountPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    expect(await screen.findByTestId("forge-import-review")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("+ New chat"));
    });
    expect(screen.queryByTestId("forge-import-review")).toBeNull();
  });

  it("attaches via the paperclip button → input path and shows a clear card", async () => {
    mountPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    // The paperclip button must actually trigger the hidden input.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Attach a document"));
    });
    expect(clickSpy).toHaveBeenCalled();

    // Simulate the OS file selection.
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });
    });

    const card = screen.getByTestId("forge-attachment");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("stmt.pdf");
  });

  // Regression (no-card-on-attach): in a real browser `e.target.files` is a
  // *live* FileList, and the onChange handler resets `e.target.value = ""` (so
  // the same file can be re-picked) — which empties that live FileList *in
  // place*. The card-building `Array.from(list)` must therefore snapshot the
  // files *synchronously* in onPickFiles; if it's left deferred inside the
  // setState updater, React runs it after value="" and reads an empty list, so
  // nothing is attached and no card appears.
  //
  // This only manifests when React's eager-state bailout is skipped (StrictMode
  // + concurrent root in dev, or any pending update). The other attach tests
  // pass because jsdom takes the eager path with no pending work — masking it.
  // We reproduce the browser path by (1) emulating a live FileList that empties
  // on value="", and (2) typing first so a pending update forces the updater to
  // run deferred.
  it("keeps the attachment when the live FileList is cleared before the deferred state update", async () => {
    mountPanel();
    const input = screen.getByTestId("forge-file-input") as HTMLInputElement;
    const file = new File(["x"], "stmt.pdf");
    // Array-like FileList stand-in, emptied in place — as the browser empties a
    // real live FileList when the input's value is reset.
    const liveFiles: { length: number; [i: number]: File } = { 0: file, length: 1 };
    Object.defineProperty(input, "files", { configurable: true, get: () => liveFiles });
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: () => {
        delete liveFiles[0];
        liveFiles.length = 0;
      },
    });
    await act(async () => {
      // A pending update in the same flush disables React's eager-state bailout,
      // forcing the setAttached updater to run deferred (the real-browser path).
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "look at this" },
      });
      fireEvent.change(input);
    });
    expect(screen.getByTestId("forge-attachment")).toHaveTextContent("stmt.pdf");
  });

  it("updates the scenario chip when the URL scenario changes (drift)", () => {
    const { rerender } = mountPanel();
    expect(screen.getByTestId("chip-scenario").textContent).toContain("Roth scenario");

    // Advisor switches ?scenario= mid-session → next render reads the new id.
    currentSearch = "scenario=s2";
    rerender(
      <ScenarioDrawerProvider>
        <ForgeProvider clientId="c1">
          <ForgePanel
            clientId="c1"
            clientName="Jane & John Smith"
            scenarioNames={{ s1: "Roth scenario", s2: "Delay SS to 70" }}
            forceOpenForTest
          />
        </ForgeProvider>
      </ScenarioDrawerProvider>,
    );
    expect(screen.getByTestId("chip-scenario").textContent).toContain("Delay SS to 70");
  });
});
