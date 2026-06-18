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
