// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-worksheet-chat.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { TURN_BUSY_MESSAGE, type TurnFrame } from "@/lib/fact-finder/api-types";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { useWorksheetChat } from "../use-worksheet-chat";

const TURN_URL = "/api/clients/c1/imports/i1/fact-finder/turn";
const AT = "2026-10-13T09:00:00.000Z";

const sse = (f: TurnFrame) => `data: ${JSON.stringify(f)}\n\n`;
const withReply = (s: FactFinderState): FactFinderState => ({
  ...s,
  version: s.version + 1,
  transcript: [...s.transcript, { id: "a1", role: "assistant", text: "Done.", at: AT }],
});

/** A turn response whose body the test writes, chunk by chunk, and closes when it chooses. */
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

function streamOf(...frames: TurnFrame[]): Response {
  return new Response(frames.map(sse).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function renderChat(...responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("no response queued");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  const adopt = vi.fn();
  const hook = renderHook(() => useWorksheetChat({ clientId: "c1", importId: "i1", adopt }));
  return { ...hook, adopt, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("useWorksheetChat", () => {
  it("send streams progress then adopts the fact finder", async () => {
    const live = liveStream();
    const fresh = withReply(emptyFactFinderState());
    const { result, adopt, fetchMock } = renderChat(live.response);

    let sent!: Promise<boolean>;
    act(() => {
      sent = result.current.send("Add a table");
    });
    expect(result.current.pending).toBe("Add a table");
    expect(fetchMock).toHaveBeenCalledWith(
      TURN_URL,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ message: "Add a table" }) }),
    );

    act(() => live.write(sse({ type: "progress", line: "Looking at the accounts…" })));
    await waitFor(() => expect(result.current.progress).toEqual(["Looking at the accounts…"]));
    act(() => live.write(sse({ type: "progress", line: "Adding the table…" })));
    await waitFor(() => expect(result.current.progress).toEqual(["Looking at the accounts…", "Adding the table…"]));

    act(() => {
      live.write(sse({ type: "done", factFinder: fresh, turnId: "a1" }));
      live.close();
    });
    await act(async () => {
      expect(await sent).toBe(true);
    });
    expect(adopt).toHaveBeenCalledWith(fresh);
    expect(result.current.pending).toBeNull();
    expect(result.current.progress).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("compose posts mode compose with no message", async () => {
    const fresh = withReply(emptyFactFinderState());
    const { result, adopt, fetchMock } = renderChat(streamOf({ type: "done", factFinder: fresh, turnId: "a1" }));

    let started = false;
    act(() => {
      started = result.current.compose();
    });

    expect(started).toBe(true);
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe(TURN_URL);
    expect(JSON.parse(String(init[1].body))).toEqual({ mode: "compose" });
    await waitFor(() => expect(adopt).toHaveBeenCalledWith(fresh));
  });

  it("compose is silent when nothing comes back changed", async () => {
    const live = liveStream();
    const same = emptyFactFinderState();
    const { result, adopt } = renderChat(live.response);

    act(() => {
      result.current.compose();
    });
    // Running, but with no message of the advisor's to show.
    expect(result.current.pending).toBe("");

    act(() => {
      live.write(sse({ type: "done", factFinder: same, turnId: null }));
      live.close();
    });
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(adopt).toHaveBeenCalledWith(same);
    expect(result.current.error).toBeNull();
  });

  it("compose while a reply is running doesn't start, and says so", async () => {
    const live = liveStream();
    const { result, fetchMock } = renderChat(live.response);

    let sent!: Promise<boolean>;
    act(() => {
      sent = result.current.send("one");
    });
    let started = true;
    act(() => {
      started = result.current.compose();
    });
    expect(started).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe("one");

    act(() => {
      live.write(sse({ type: "done", factFinder: emptyFactFinderState(), turnId: null }));
      live.close();
    });
    expect(await sent).toBe(true);
  });

  it("an error frame shows its message", async () => {
    const saved = withReply(emptyFactFinderState());
    const { result, adopt } = renderChat(
      streamOf({ type: "progress", line: "Working…" }, { type: "error", message: "The reply failed.", factFinder: saved }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.send("hi");
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe("The reply failed.");
    expect(adopt).toHaveBeenCalledWith(saved);
    expect(result.current.pending).toBeNull();
  });

  it("a 409 before the stream shows the refusal", async () => {
    const { result } = renderChat(
      new Response(JSON.stringify({ error: TURN_BUSY_MESSAGE }), { status: 409, headers: { "content-type": "application/json" } }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.send("hi");
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(TURN_BUSY_MESSAGE);
    expect(result.current.pending).toBeNull();
  });

  it("send while a reply is running returns false", async () => {
    const live = liveStream();
    const { result, fetchMock } = renderChat(live.response);

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.send("one");
    });
    let second = true;
    await act(async () => {
      second = await result.current.send("two");
    });
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      live.write(sse({ type: "done", factFinder: emptyFactFinderState(), turnId: null }));
      live.close();
    });
    expect(await first).toBe(true);
  });

  it("a network failure or a stream that ends without a final frame says so", async () => {
    const offline = renderChat(new TypeError("Failed to fetch"));
    await act(async () => {
      await offline.result.current.send("hi");
    });
    expect(offline.result.current.error).toBe("Couldn't reach the server. Check your connection.");

    const cut = renderChat(streamOf({ type: "progress", line: "Working…" }));
    await act(async () => {
      await cut.result.current.send("hi");
    });
    expect(cut.result.current.error).toBe("The reply stopped before it finished. Try again.");
    expect(cut.result.current.progress).toEqual([]);
  });

  it("undo posts the reply's id and adopts the result", async () => {
    const fresh = emptyFactFinderState();
    const { result, adopt, fetchMock } = renderChat(
      new Response(JSON.stringify({ factFinder: fresh }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    await act(() => result.current.undo("a1"));

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/clients/c1/imports/i1/fact-finder/undo");
    expect(JSON.parse(String(call[1].body))).toEqual({ turnId: "a1" });
    expect(adopt).toHaveBeenCalledWith(fresh);
    expect(result.current.undoing).toBeNull();
  });
});
