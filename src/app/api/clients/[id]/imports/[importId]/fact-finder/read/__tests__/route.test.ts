// src/app/api/clients/[id]/imports/[importId]/fact-finder/read/__tests__/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READ_BUSY_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/read-run", () => ({ READ_BUDGET_MS: 270_000, runFactFinderRead: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "../route";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderClosedError } from "@/lib/fact-finder/persist";
import { runFactFinderRead } from "@/lib/fact-finder/read-run";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const req = () => new Request("http://t/api/clients/c1/imports/i1/fact-finder/read", { method: "POST" });

async function readSse(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)));
}

const gateWith = (payloadJson: unknown) => ({
  ok: true as const,
  firmId: "org_1",
  userId: "user_1",
  clientId: "c1",
  importId: "i1",
  imp: { extractHoldings: true } as never,
  payloadJson: payloadJson as never,
});
/** A fact finder whose one file started reading `msAgo` ago. */
const readingStarted = (msAgo: number) => ({
  factFinder: { readings: { f1: { status: "reading", startedAt: new Date(Date.now() - msAgo).toISOString() } } },
});
const DONE = { summary: "Read 1 document. 1 section has values.", caveats: [], version: 4, filesRead: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(factFinderGate).mockResolvedValue(gateWith({ chat: { surface: "chat" } }));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /fact-finder/read", () => {
  it("passes a gate refusal straight through, before any reading", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 429 }) });
    expect((await POST(req(), params)).status).toBe(429);
    expect(runFactFinderRead).not.toHaveBeenCalled();
  });

  it("uses the extract bucket and streams each file, then done", async () => {
    vi.mocked(runFactFinderRead).mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" });
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "done", reader: "statement", rows: 3 });
      return { summary: "Read 1 document. 2 sections have values.", caveats: [], version: 4, filesRead: 1 };
    });
    const res = await POST(req(), params);
    expect(factFinderGate).toHaveBeenCalledWith(params.params, "extract");
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(await readSse(res)).toEqual([
      { type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" },
      { type: "file", fileId: "f1", fileName: "a.pdf", status: "done", reader: "statement", rows: 3 },
      { type: "done", summary: "Read 1 document. 2 sections have values.", caveats: [], version: 4 },
    ]);
    expect(vi.mocked(runFactFinderRead).mock.calls[0][0]).toMatchObject({
      scope: { importId: "i1", clientId: "c1", firmId: "org_1" },
      extractHoldings: true,
    });
  });

  it("ends the stream with an error frame when the read throws — the fact finder's own refusals in their words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFactFinderRead).mockRejectedValueOnce(new FactFinderBusyError());
    expect(await readSse(await POST(req(), params))).toEqual([
      { type: "error", message: "The fact finder is busy — try again in a moment." },
    ]);
    vi.mocked(runFactFinderRead).mockRejectedValueOnce(new FactFinderClosedError());
    expect(await readSse(await POST(req(), params))).toEqual([{ type: "error", message: SAVE_CLOSED_MESSAGE }]);
  });

  it("never sends any other error's text: a fixed line, the detail logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFactFinderRead).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    expect(await readSse(await POST(req(), params))).toEqual([{ type: "error", message: "Reading stopped — try again." }]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("fact-finder/read"), expect.objectContaining({ message: "Connection terminated unexpectedly" }));
  });

  it("refuses a second read while a document is reading (Review Focus 4)", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(60_000)));
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: READ_BUSY_MESSAGE });
    expect(runFactFinderRead).not.toHaveBeenCalled();
  });

  it("reads again when the earlier read was abandoned over six minutes ago", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(7 * 60 * 1000)));
    vi.mocked(runFactFinderRead).mockResolvedValue(DONE);
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await readSse(res)).toEqual([{ type: "done", summary: DONE.summary, caveats: [], version: 4 }]);
  });

  it("stops starting new files at the time budget and still ends with done", async () => {
    const budget = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(budget.signal);
    let stoppedBeforeReturning = false;
    vi.mocked(runFactFinderRead).mockImplementation(async ({ onEvent, signal }) => {
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" });
      budget.abort();
      stoppedBeforeReturning = signal?.aborted === true;
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "failed", error: "Stopped before this file was read." });
      return {
        summary: "Couldn't read 1 document — Retry it. 0 sections have values.",
        caveats: ["Couldn't read a.pdf: Stopped before this file was read."],
        version: 3,
        filesRead: 0,
      };
    });

    const frames = await readSse(await POST(req(), params));

    expect(timeout).toHaveBeenCalledWith(270_000);
    expect(stoppedBeforeReturning).toBe(true);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toEqual({
      type: "done",
      summary: "Couldn't read 1 document — Retry it. 0 sections have values.",
      caveats: ["Couldn't read a.pdf: Stopped before this file was read."],
      version: 3,
    });
  });

  it("stops the read and sends nothing more once the advisor leaves", async () => {
    let leave!: () => void;
    const left = new Promise<void>((resolve) => (leave = resolve));
    let readSignal: AbortSignal | undefined;
    let sendError: unknown = null;
    let finished = false;
    vi.mocked(runFactFinderRead).mockImplementation(async ({ onEvent, signal }) => {
      readSignal = signal;
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" });
      await left;
      try {
        onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "done", reader: "section", rows: 1 });
      } catch (err) {
        sendError = err;
      }
      finished = true;
      return DONE;
    });

    const reader = (await POST(req(), params)).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(readSignal?.aborted).toBe(true);
    leave();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(sendError).toBeNull();
  });
});
