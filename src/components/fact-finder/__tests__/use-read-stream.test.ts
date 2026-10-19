// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-read-stream.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { READ_BUSY_MESSAGE, SAVE_CLOSED_MESSAGE, type ReadFrame } from "@/lib/fact-finder/api-types";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { parseReadSse, useReadStream } from "../use-read-stream";

const READ_URL = "/api/clients/c1/imports/i1/fact-finder/read";

const sse = (f: ReadFrame) => `data: ${JSON.stringify(f)}\n\n`;
const reading = (fileId: string): ReadFrame => ({ type: "file", fileId, fileName: `${fileId}.pdf`, status: "reading" });
const read = (fileId: string): ReadFrame => ({
  type: "file",
  fileId,
  fileName: `${fileId}.pdf`,
  status: "done",
  reader: "section",
  rows: 2,
});
const failed = (fileId: string): ReadFrame => ({
  type: "file",
  fileId,
  fileName: `${fileId}.pdf`,
  status: "failed",
  error: "Couldn't read this document — try again.",
});
const finished: ReadFrame = { type: "done", summary: "Read 1 document.", caveats: [], version: 3 };

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
    write: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function renderRead(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fetchMock);
  const onFileFinished = vi.fn();
  const onDone = vi.fn();
  const adopt = vi.fn();
  const hook = renderHook(() => useReadStream({ clientId: "c1", importId: "i1", onFileFinished, onDone, adopt }));
  return { ...hook, fetchMock, onFileFinished, onDone, adopt };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseReadSse", () => {
  it("yields every complete frame in the buffer and returns the unfinished tail", () => {
    const frames = parseReadSse(sse(reading("f1")) + sse(read("f1")) + 'data: {"type":"fi');
    const seen: ReadFrame[] = [];
    let next = frames.next();
    while (!next.done) {
      seen.push(next.value);
      next = frames.next();
    }
    expect(seen).toEqual([reading("f1"), read("f1")]);
    expect(next.value).toBe('data: {"type":"fi');
  });

  it("skips a malformed frame and keeps going", () => {
    const frames = [...parseReadSse(`data: {not json\n\n${sse(finished)}`)];
    expect(frames).toEqual([finished]);
  });
});

describe("useReadStream", () => {
  it("follows the frames across chunk boundaries, several to a chunk", async () => {
    const stream = liveStream();
    const { result, fetchMock, onFileFinished, onDone } = renderRead(stream.response);

    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(READ_URL, { method: "POST" });

    const all = sse(reading("f1")) + sse(reading("f2")) + sse(read("f1")) + sse(failed("f2")) + sse(finished);
    const cut = sse(reading("f1")).length + sse(reading("f2")).length + 10;
    act(() => stream.write(all.slice(0, cut)));
    await waitFor(() => expect(result.current.lines.f2?.status).toBe("reading"));
    expect(result.current.lines.f1.status).toBe("reading");
    expect(onFileFinished).not.toHaveBeenCalled();

    act(() => {
      stream.write(all.slice(cut));
      stream.close();
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.lines).toEqual({ f1: read("f1"), f2: failed("f2") });
    expect(onFileFinished.mock.calls.map(([line]) => line.fileId)).toEqual(["f1", "f2"]);
    expect(onDone).toHaveBeenCalledWith(finished);
    expect(result.current.error).toBeNull();
  });

  it("runs one read at a time: asking again while one runs queues a single follow-up", async () => {
    const first = liveStream();
    const second = liveStream();
    const { result, fetchMock, onDone } = renderRead(first.response, second.response);

    act(() => {
      result.current.start();
      result.current.start();
      result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      first.write(sse(finished));
      first.close();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.running).toBe(true);

    act(() => {
      second.write(sse(finished));
      second.close();
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("shows the server's message when a read is refused, with when to try again", async () => {
    const { result } = renderRead(
      jsonResponse(409, { error: READ_BUSY_MESSAGE }),
      jsonResponse(429, { error: "Too many requests." }, { "retry-after": "30" }),
    );

    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe(READ_BUSY_MESSAGE));
    expect(result.current.running).toBe(false);

    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe("Too many requests. Retry in 30s."));
    expect(result.current.running).toBe(false);
  });

  it("a read refused because another tab saved the import hands the saved fact finder to the screen", async () => {
    const saved = { ...emptyFactFinderState(), version: 6, closed: { at: "2026-10-15T12:00:00.000Z", by: "user_2", saved: [], leftOut: [] } };
    const { result, adopt } = renderRead(jsonResponse(409, { error: SAVE_CLOSED_MESSAGE, factFinder: saved }), jsonResponse(409, { error: READ_BUSY_MESSAGE }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe(SAVE_CLOSED_MESSAGE));
    expect(adopt).toHaveBeenCalledExactlyOnceWith(saved);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe(READ_BUSY_MESSAGE));
    expect(adopt).toHaveBeenCalledOnce();
  });

  it("an error frame ends the read with its message; files left reading drop back to the screen's state", async () => {
    const stream = liveStream();
    const { result, onDone } = renderRead(stream.response);

    act(() => result.current.start());
    act(() => {
      stream.write(sse(reading("f1")) + sse(reading("f2")) + sse(read("f1")));
      stream.write(sse({ type: "error", message: "Reading failed." }));
      stream.close();
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.error).toBe("Reading failed.");
    expect(result.current.lines).toEqual({ f1: read("f1") });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a read that closes without its final frame says it stopped, instead of hanging", async () => {
    const stream = liveStream();
    const { result, onDone } = renderRead(stream.response);

    act(() => result.current.start());
    act(() => {
      stream.write(sse(reading("f1")));
      stream.close();
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.error).toBe("Reading stopped before it finished. Retry to read the rest.");
    expect(result.current.lines).toEqual({});
    expect(onDone).not.toHaveBeenCalled();
  });

  it("says so when the server can't be reached", async () => {
    const { result } = renderRead(new TypeError("Failed to fetch"));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");
  });
});
