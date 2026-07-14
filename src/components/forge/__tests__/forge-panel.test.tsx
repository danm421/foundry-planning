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

function makeFramedResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// Drive the URL scope. `current` is reassigned per render to simulate drift.
let currentSearch = "scenario=s1";
const currentPath = "/clients/c1/overview";
const navMocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, refresh: vi.fn() }),
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

// Task 9 handoff: mock the walkthrough context so the panel can render outside
// a real WalkthroughProvider, and so the test can assert `start` was called
// with the id carried by a `walkthrough` SSE frame.
const startWalkthrough = vi.hoisted(() => vi.fn());
vi.mock("../walkthrough-context", () => ({
  useWalkthrough: () => ({
    active: null,
    stepIndex: 0,
    currentStep: null,
    start: startWalkthrough,
    next: vi.fn(),
    exit: vi.fn(),
  }),
}));

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
  startWalkthrough.mockReset();
  importMocks.runImport.mockReset();
  importMocks.runImport.mockResolvedValue(IMPORT_RESULT);
  navMocks.push.mockReset();
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

  it("autofocuses the composer when the panel opens so the advisor can type immediately", () => {
    mountPanel();
    expect(screen.getByLabelText("Ask Forge")).toHaveFocus();
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

  it("renders a page-citation chip after a page_link frame and navigates on click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeFramedResponse([
          `data: {"type":"token","text":"Net worth is $4.2M."}\n\n`,
          `data: {"type":"page_link","href":"/clients/c1/assets/balance-sheet-report","section":"balance-sheet","label":"Balance Sheet"}\n\n`,
          `data: {"type":"done"}\n\n`,
        ]),
      ),
    );
    mountPanel();
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "What's their net worth?" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    const chip = await screen.findByRole("button", { name: /balance sheet/i });
    expect(chip).toHaveAttribute("data-href", "/clients/c1/assets/balance-sheet-report");

    fireEvent.click(chip);
    expect(navMocks.push).toHaveBeenCalledWith("/clients/c1/assets/balance-sheet-report");
  });

  it("hands a pendingWalkthrough off to the walkthrough provider and clears it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeFramedResponse([
          `data: {"type":"walkthrough","walkthroughId":"add-household"}\n\n`,
          `data: {"type":"done"}\n\n`,
        ]),
      ),
    );
    mountPanel();
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "show me how to add a household" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    // The handoff effect calls start() with the walkthrough id and closes the panel.
    expect(startWalkthrough).toHaveBeenCalledWith("add-household");
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

// ---------------------------------------------------------------------------
// E2 — Human-readable tool-status labels + persistent "Working…" sentinel
// ---------------------------------------------------------------------------
// Drive via the real useForgeStream hook (same SSE-mock pattern as A4): emit
// SSE frames from a controlled fetch and assert the rendered DOM.

describe("ForgePanel — E2: tool-status labels + Working… sentinel", () => {
  it("renders a human label for a mapped tool name (run_monte_carlo)", async () => {
    // Stream: tool_start(run_monte_carlo) then done — the status line should
    // show the human label, NOT the raw identifier.
    // Use a paused stream so we can observe the status line before done clears it.
    let releaseDone!: () => void;
    const encoder = new TextEncoder();
    const labelStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: {"type":"tool_start","name":"run_monte_carlo"}\n\n`),
        );
        releaseDone = () => {
          controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`));
          controller.close();
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(labelStream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    mountPanel();

    // Phase 1: Start the send and let the first frame flush, then check mid-stream
    // DOM (before done), then release and finish.
    let sendResolve!: () => void;
    // Kick off the send; we check mid-stream then release.
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "run a monte carlo" },
      });
    });
    // Send fires the fetch. Wrap click + small delay together in one awaited act.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
      await new Promise<void>((r) => { sendResolve = r; setTimeout(r, 20); });
    });
    // Mid-stream (tool_start fired, done not yet): the status line shows the human label.
    expect(screen.getByText(/Running a Monte Carlo simulation/i)).toBeInTheDocument();
    // The raw identifier must never leak through.
    expect(screen.queryByText(/run_monte_carlo/)).toBeNull();
    // Clean up: release the stream.
    await act(async () => {
      releaseDone();
      sendResolve?.();
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  it("shows 'Working…' after tool_end with no following token (no blank flicker)", async () => {
    // Control the stream: emit tool_start + tool_end, hold it open, then check
    // "Working…" is visible, then release done to confirm it clears.
    let releaseDone!: () => void;
    const encoder = new TextEncoder();
    const sentinelStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"tool_start","name":"run_monte_carlo"}\n\n` +
            `data: {"type":"tool_end","name":"run_monte_carlo"}\n\n`,
          ),
        );
        releaseDone = () => {
          controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`));
          controller.close();
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sentinelStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    mountPanel();
    // Fire send and wait for the initial frames to flush (tool_start + tool_end).
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "run monte carlo" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
      await new Promise((r) => setTimeout(r, 20));
    });
    // After tool_end, before done: "Working…" must be visible (sentinel is set).
    expect(screen.getByText(/Working…/)).toBeInTheDocument();
    // Release done — sentinel clears and "Working…" disappears.
    await act(async () => {
      releaseDone();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(/Working…/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A4 — Retry button + rate-limit countdown on the error state
// ---------------------------------------------------------------------------
// Drive error state through the real useForgeStream hook (same pattern as the
// tests above) — return a non-ok Response from fetch so the hook sets
// status === "error", then assert the Retry affordance renders and fires.
describe("ForgePanel error state — A4", () => {
  /** Returns a non-ok Response that drives the hook into status==="error". */
  function makeErrorResponse(status = 500, body = "Server error", headers?: HeadersInit) {
    return Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-type": "text/plain", ...headers },
      }),
    );
  }

  async function mountAndTriggerError(fetchResponse: Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(fetchResponse));
    mountPanel();
    // Type and send a message so the hook fires a request and enters error state.
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "what is the plan?" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
  }

  it("shows a Retry button when status is error", async () => {
    await mountAndTriggerError(makeErrorResponse(500));
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("clicking Retry re-fires a fetch (calls the hook's retry)", async () => {
    const fetchMock = vi.fn().mockReturnValue(makeErrorResponse(500));
    vi.stubGlobal("fetch", fetchMock);
    mountPanel();
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: /ask forge/i }), {
        target: { value: "what is the plan?" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });

    // Wait for the Retry button to appear.
    const retryBtn = await screen.findByRole("button", { name: /retry/i });
    const callsBefore = fetchMock.mock.calls.length;

    // Stub a clean response so the retry doesn't recurse into another error.
    fetchMock.mockReturnValueOnce(
      Promise.resolve(new Response(
        new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: {"type":"done"}\n\n`)); c.close(); } }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )),
    );

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    // fetch must have been called at least once more after the Retry click.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    // The new call must be the /forge/stream route.
    const retryCalls = fetchMock.mock.calls.slice(callsBefore);
    expect(retryCalls.some((c) => String(c[0]).includes("/forge/stream"))).toBe(true);
  });

  it("shows a rate-limit countdown when Retry-After is returned on 503", async () => {
    await mountAndTriggerError(makeErrorResponse(503, "Forge is temporarily unavailable", { "retry-after": "30" }));
    // The error block should show "try again in ~30s" (or similar countdown text).
    expect(await screen.findByText(/try again in ~30s/i)).toBeInTheDocument();
  });
});
