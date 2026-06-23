// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { parseForgeSse, useForgeStream, type ForgeSseEvent } from "../use-forge-stream";

/** Feed a sequence of raw chunks through the stateful boundary parser. */
function drain(chunks: string[]): ForgeSseEvent[] {
  let buffer = "";
  const out: ForgeSseEvent[] = [];
  for (const chunk of chunks) {
    buffer += chunk;
    const it = parseForgeSse(buffer);
    let next = it.next();
    while (!next.done) {
      out.push(next.value);
      next = it.next();
    }
    buffer = next.value as string; // leftover partial frame carried forward
  }
  return out;
}

describe("parseForgeSse", () => {
  it("handles a frame split across two chunks without dropping or duplicating", () => {
    const events = drain([
      // chunk A: a complete conversation frame + the START of a token frame
      `data: {"type":"conversation","conversationId":"c9"}\n\ndata: {"type":"to`,
      // chunk B: the REST of the token frame + tool_start + tool_end + done
      `ken","text":"Hello"}\n\ndata: {"type":"tool_start","name":"run_monte_carlo"}\n\ndata: {"type":"tool_end","name":"run_monte_carlo"}\n\ndata: {"type":"done"}\n\n`,
    ]);

    expect(events).toEqual([
      { type: "conversation", conversationId: "c9" },
      { type: "token", text: "Hello" },
      { type: "tool_start", name: "run_monte_carlo" },
      { type: "tool_end", name: "run_monte_carlo" },
      { type: "done" },
    ]);
  });

  it("emits nothing until a full frame boundary is seen", () => {
    const events = drain([`data: {"type":"token","text":"par`]);
    expect(events).toEqual([]);
  });

  it("parses an approval_required frame with previews and calls", () => {
    const events = drain([
      `data: {"type":"approval_required","previews":[{"summary":"Add Roth conversion","name":"propose_changes"}],"calls":[{"id":"t1","name":"propose_changes","args":{}}]}\n\n`,
    ]);
    expect(events).toEqual([
      {
        type: "approval_required",
        previews: [{ summary: "Add Roth conversion", name: "propose_changes" }],
        calls: [{ id: "t1", name: "propose_changes", args: {} }],
      },
    ]);
  });

  it("parses a verifying frame", () => {
    const events = drain([`data: {"type":"verifying"}\n\n`]);
    expect(events).toEqual([{ type: "verifying" }]);
  });
});

// ---------------------------------------------------------------------------
// useForgeStream.send — fetch body wiring
// ---------------------------------------------------------------------------

/** Build a minimal streaming Response whose body emits a single SSE done frame. */
function makeStreamingResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const validArgs = {
  message: "Hello forge",
  scenarioId: "scen_1",
};

/** Build a streaming Response from an array of raw SSE frame strings. */
function makeFramedResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("useForgeStream.send", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamingResponse()));
  });

  it("includes pendingImportId in the fetch body when provided", async () => {
    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send({ ...validArgs, pendingImportId: "imp_7" });
    });

    const body = JSON.parse(
      (globalThis.fetch as Mock).mock.calls[0][1].body as string,
    );
    expect(body.pendingImportId).toBe("imp_7");
  });

  it("attaches `attachments` to the pushed user message (display only)", async () => {
    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send({ ...validArgs, attachments: ["stmt.pdf"] });
    });

    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg?.attachments).toEqual(["stmt.pdf"]);

    // attachments are display-only — they must NOT go in the fetch body.
    const body = JSON.parse((globalThis.fetch as Mock).mock.calls[0][1].body as string);
    expect(body.attachments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Custom-streaming seam — structured frames (plumbing only)
// ---------------------------------------------------------------------------

describe("custom-streaming frames", () => {
  it("parseForgeSse parses tool_render / navigate / activity frames", () => {
    const events = drain([
      `data: {"type":"tool_render","name":"run_projection","status":"complete","data":{"median":1}}\n\n` +
        `data: {"type":"navigate","href":"/clients/c1/scenarios/s1"}\n\n` +
        `data: {"type":"activity","label":"Loading"}\n\n`,
    ]);
    expect(events).toEqual([
      { type: "tool_render", name: "run_projection", status: "complete", data: { median: 1 } },
      { type: "navigate", href: "/clients/c1/scenarios/s1" },
      { type: "activity", label: "Loading" },
    ]);
  });

  it("parseForgeSse parses a page_link frame", () => {
    const events = drain([
      `data: {"type":"page_link","href":"/clients/c1/assets/balance-sheet-report","section":"balance-sheet","label":"Balance Sheet"}\n\n`,
    ]);
    expect(events).toEqual([
      {
        type: "page_link",
        href: "/clients/c1/assets/balance-sheet-report",
        section: "balance-sheet",
        label: "Balance Sheet",
      },
    ]);
  });

  it("send accumulates page_link frames (de-duped by section) onto the trailing assistant message", async () => {
    const frames = [
      `data: {"type":"token","text":"Net worth is $4.2M."}\n\n`,
      `data: {"type":"page_link","href":"/clients/c1/assets/balance-sheet-report","section":"balance-sheet","label":"Balance Sheet"}\n\n`,
      // duplicate section — must NOT add a second chip
      `data: {"type":"page_link","href":"/clients/c1/assets/balance-sheet-report","section":"balance-sheet","label":"Balance Sheet"}\n\n`,
      `data: {"type":"page_link","href":"/clients/c1/details/net-worth","section":"net-worth","label":"Net Worth"}\n\n`,
      `data: {"type":"done"}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFramedResponse(frames)));

    const { result } = renderHook(() => useForgeStream("c1"));
    await act(async () => {
      await result.current.send({ message: "What's their net worth?", scenarioId: "base" });
    });

    const assistant = result.current.messages.at(-1)!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.pageLinks).toEqual([
      { href: "/clients/c1/assets/balance-sheet-report", section: "balance-sheet", label: "Balance Sheet" },
      { href: "/clients/c1/details/net-worth", section: "net-worth", label: "Net Worth" },
    ]);
  });

  it("pageLinks survive a token frame that arrives AFTER the page_link frame (real server order)", async () => {
    // Real server order: cite_page tool emits page_link, THEN the answer tokens
    // flush through the verify-gate. The token case must not clobber pageLinks.
    const frames = [
      `data: {"type":"token","text":"Net worth is "}\n\n`,
      `data: {"type":"page_link","href":"/clients/c1/details/net-worth","section":"net-worth","label":"Net Worth"}\n\n`,
      `data: {"type":"token","text":"$4.2M."}\n\n`, // ← token AFTER page_link
      `data: {"type":"done"}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFramedResponse(frames)));

    const { result } = renderHook(() => useForgeStream("c1"));
    await act(async () => {
      await result.current.send({ message: "What's their net worth?", scenarioId: "base" });
    });

    const assistant = result.current.messages.at(-1)!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.text).toBe("Net worth is $4.2M.");
    expect(assistant.pageLinks).toEqual([
      { href: "/clients/c1/details/net-worth", section: "net-worth", label: "Net Worth" },
    ]);
  });

  it("send stashes lastToolRender + pendingNavigate without breaking the stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"tool_render","name":"run_projection","status":"complete","data":{"median":2}}\n\n` +
              `data: {"type":"navigate","href":"/clients/c1/scenarios/s2"}\n\n` +
              `data: {"type":"done"}\n\n`,
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );

    const { result } = renderHook(() => useForgeStream("client_42"));
    await act(async () => {
      await result.current.send({ message: "go", scenarioId: "scen_1" });
    });

    expect(result.current.lastToolRender).toMatchObject({ type: "tool_render", name: "run_projection" });
    expect(result.current.pendingNavigate).toBe("/clients/c1/scenarios/s2");
    expect(result.current.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// useForgeStream — isVerifying state transitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// useForgeStream — error/cancel recovery (Task A3)
// ---------------------------------------------------------------------------

describe("useForgeStream — error/cancel recovery", () => {
  it("(a) removes the trailing empty assistant bubble on a non-503 !res.ok error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.status).toBe("error");
    // The empty assistant bubble must be dropped — only the user turn remains.
    expect(result.current.messages).toEqual([
      { role: "user", text: "Hello forge", attachments: undefined },
    ]);
    expect(result.current.messages.some((m) => m.role === "assistant")).toBe(false);
  });

  it("(b) suffixes a partial assistant bubble with ' (stopped)' on cancel", async () => {
    // A stream that emits one token then stays open until the fetch signal
    // aborts, at which point the reader errors (mirrors a real cancelled fetch).
    const encoder = new TextEncoder();
    const { result } = renderHook(() => useForgeStream("client_42"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        let enqueued = false;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!enqueued) {
              enqueued = true;
              controller.enqueue(encoder.encode(`data: {"type":"token","text":"Partial"}\n\n`));
              return;
            }
            // Block until abort, then error the stream so reader.read() rejects.
            return new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                const err = new DOMException("Aborted", "AbortError");
                controller.error(err);
                reject(err);
              });
            });
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );

    // Fire send without awaiting — it will stream the token then block.
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send(validArgs);
      // Let the token frame flush into the assistant bubble.
      await new Promise((r) => setTimeout(r, 10));
    });

    // The partial assistant bubble should now hold "Partial".
    expect(result.current.messages.at(-1)).toEqual({ role: "assistant", text: "Partial" });

    await act(async () => {
      result.current.cancel();
      await sendPromise;
    });

    expect(result.current.status).toBe("cancelled");
    expect(result.current.messages.at(-1)).toEqual({
      role: "assistant",
      text: "Partial (stopped)",
    });
  });

  it("(c) parses Retry-After: 30 on a 503 into retryAfterSeconds === 30", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("rate limited", {
          status: 503,
          headers: { "retry-after": "30" },
        }),
      ),
    );

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.retryAfterSeconds).toBe(30);
  });

  it("(d) retry() re-POSTs the last user message with the existing conversationId + scenario", async () => {
    // First send: 503 (failure) so we have a stranded user turn to retry. It
    // carries a conversation frame so conversationId is populated for retry.
    const fetchMock = vi
      .fn()
      // initial send fails before streaming, but we still want a conversationId
      // — set it manually via setConversationId below instead.
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      // retry succeeds.
      .mockResolvedValueOnce(makeStreamingResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useForgeStream("client_42"));

    act(() => {
      result.current.setConversationId("conv_99");
    });

    await act(async () => {
      await result.current.send({ message: "What is my balance?", scenarioId: "scen_7" });
    });

    expect(result.current.status).toBe("error");

    await act(async () => {
      await result.current.retry();
    });

    // The retry re-POSTed the same message + scenario + conversationId.
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(retryBody.message).toBe("What is my balance?");
    expect(retryBody.scenarioId).toBe("scen_7");
    expect(retryBody.conversationId).toBe("conv_99");
    expect(result.current.status).toBe("done");
  });

  it("clears retryAfterSeconds at the top of a new send", async () => {
    // First send: 503 with Retry-After sets retryAfterSeconds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 503, headers: { "retry-after": "12" } }),
      )
      .mockResolvedValueOnce(makeStreamingResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });
    expect(result.current.retryAfterSeconds).toBe(12);

    await act(async () => {
      await result.current.send(validArgs);
    });
    expect(result.current.retryAfterSeconds).toBeNull();
  });
});

describe("useForgeStream — isVerifying", () => {
  it("sets isVerifying to true when a verifying event arrives (no token follows)", async () => {
    // Only a verifying frame — no token, no done. The flag should be set and
    // nothing clears it (token never arrives).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeFramedResponse([`data: {"type":"verifying"}\n\n`]),
      ),
    );

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.isVerifying).toBe(true);
  });

  it("clears isVerifying to false when a token arrives after verifying", async () => {
    // verifying → token → done: token should clear isVerifying.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeFramedResponse([
          `data: {"type":"verifying"}\n\n`,
          `data: {"type":"token","text":"Balance is $1."}\n\n`,
          `data: {"type":"done"}\n\n`,
        ]),
      ),
    );

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.isVerifying).toBe(false);
  });
});
