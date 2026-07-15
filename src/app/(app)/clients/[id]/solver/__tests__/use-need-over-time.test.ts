// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { parseSseStream, useNeedOverTime } from "../use-need-over-time";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

describe("parseSseStream", () => {
  it("yields complete events and returns the trailing partial", () => {
    const buffer =
      "event: progress\ndata: {\"done\":1}\n\nevent: result\ndata: par";
    const it = parseSseStream(buffer);

    const first = it.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ event: "progress", data: '{"done":1}' });

    const second = it.next();
    expect(second.done).toBe(true);
    expect(second.value).toBe("event: result\ndata: par");
  });

  it("returns the whole buffer when no event boundary is present", () => {
    const it = parseSseStream("event: progress\ndata: {}");
    const first = it.next();
    expect(first.done).toBe(true);
    expect(first.value).toBe("event: progress\ndata: {}");
  });
});

// ---------------------------------------------------------------------------
// useNeedOverTime — streamed accumulation + year range
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-1";

const ASSUMPTIONS: LiAssumptions = {
  deathYear: 2026,
  modelPortfolioId: null,
  leaveToHeirsAmount: 0,
  livingExpenseAtDeath: null,
  payoffLiabilityIds: [],
  mcTargetScore: 0.9,
  coverEstateTaxes: false,
  scenarioRef: "base",
};

/** Build a streaming Response from an array of raw SSE frame strings —
 *  mirrors the harness in `use-forge-stream.test.ts` for the same
 *  fetch-stream-SSE-hook shape. */
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

/** Build a streaming Response whose frames are delivered one at a time via an
 *  externally-held enqueue handle — mirrors the `pull()`-based staged
 *  controller in `use-forge-stream.test.ts`'s cancel-recovery test, adapted
 *  so the caller can push a single SSE frame per `act()` boundary instead of
 *  enqueuing everything synchronously before the stream closes. This is what
 *  lets a test observe `rows` mid-stream, before the terminal `result` event
 *  (which overwrites `rows` with the full authoritative array) has landed. */
function makeStagedResponse(): {
  response: Response;
  push: (frame: string) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push: (frame: string) => ctrl.enqueue(encoder.encode(frame)),
    close: () => ctrl.close(),
  };
}

describe("useNeedOverTime", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("accumulates streamed rows and exposes the year range", async () => {
    const frames = [
      'event: meta\ndata: {"planStartYear":2026,"planEndYear":2027}\n\n',
      'event: progress\ndata: {"done":1,"total":2,"row":{"year":2026,"clientNeed":100,"spouseNeed":50,"clientStatus":"solved","spouseStatus":"solved"}}\n\n',
      'event: progress\ndata: {"done":2,"total":2,"row":{"year":2027,"clientNeed":120,"spouseNeed":60,"clientStatus":"solved","spouseStatus":"solved"}}\n\n',
      'event: result\ndata: {"rows":[{"year":2026,"clientNeed":100,"spouseNeed":50,"clientStatus":"solved","spouseStatus":"solved"},{"year":2027,"clientNeed":120,"spouseNeed":60,"clientStatus":"solved","spouseStatus":"solved"}]}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFramedResponse(frames)));

    const { result } = renderHook(() =>
      useNeedOverTime(CLIENT_ID, ASSUMPTIONS, true, "base", []),
    );

    await waitFor(() =>
      expect(result.current.yearRange).toEqual({
        planStartYear: 2026,
        planEndYear: 2027,
      }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    // The terminal `result` event still lands and matches the accumulated rows.
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.rows).toEqual([
      { year: 2026, clientNeed: 100, spouseNeed: 50, clientStatus: "solved", spouseStatus: "solved" },
      { year: 2027, clientNeed: 120, spouseNeed: 60, clientStatus: "solved", spouseStatus: "solved" },
    ]);
  });

  it("exposes accumulated rows MID-STREAM, before the terminal `result` event lands", async () => {
    // Regression guard for the incremental-append line in the `progress`
    // branch: if it were deleted, `rows` would stay `[]` here instead of
    // growing to length 1 / 2 as each `progress` row arrives — a test that
    // only asserts after `result` (which sets the full authoritative array
    // via `setRows(parsed.rows)`) can't tell the difference.
    const { response, push, close } = makeStagedResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const { result } = renderHook(() =>
      useNeedOverTime(CLIENT_ID, ASSUMPTIONS, true, "base", []),
    );

    await act(async () => {
      push('event: meta\ndata: {"planStartYear":2026,"planEndYear":2028}\n\n');
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.yearRange).toEqual({
      planStartYear: 2026,
      planEndYear: 2028,
    });
    expect(result.current.rows).toEqual([]);

    await act(async () => {
      push(
        'event: progress\ndata: {"done":1,"total":3,"row":{"year":2026,"clientNeed":100,"spouseNeed":50,"clientStatus":"solved","spouseStatus":"solved"}}\n\n',
      );
      await new Promise((r) => setTimeout(r, 10));
    });

    // Mid-stream assertion — strictly BEFORE the terminal `result` event —
    // this is the assertion that fails if the incremental-append line is
    // removed.
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows).toEqual([
      { year: 2026, clientNeed: 100, spouseNeed: 50, clientStatus: "solved", spouseStatus: "solved" },
    ]);
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      push(
        'event: progress\ndata: {"done":2,"total":3,"row":{"year":2027,"clientNeed":120,"spouseNeed":60,"clientStatus":"solved","spouseStatus":"solved"}}\n\n',
      );
      await new Promise((r) => setTimeout(r, 10));
    });

    // Still mid-stream — the second row appended on top of the first.
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows).toEqual([
      { year: 2026, clientNeed: 100, spouseNeed: 50, clientStatus: "solved", spouseStatus: "solved" },
      { year: 2027, clientNeed: 120, spouseNeed: 60, clientStatus: "solved", spouseStatus: "solved" },
    ]);

    await act(async () => {
      push(
        'event: result\ndata: {"rows":[{"year":2026,"clientNeed":100,"spouseNeed":50,"clientStatus":"solved","spouseStatus":"solved"},{"year":2027,"clientNeed":120,"spouseNeed":60,"clientStatus":"solved","spouseStatus":"solved"},{"year":2028,"clientNeed":140,"spouseNeed":70,"clientStatus":"solved","spouseStatus":"solved"}]}\n\n',
      );
      close();
      await new Promise((r) => setTimeout(r, 10));
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    // The terminal `result` event replaces the accumulator with the full
    // authoritative array — including the 2028 row that never streamed as
    // its own `progress` event.
    expect(result.current.rows).toEqual([
      { year: 2026, clientNeed: 100, spouseNeed: 50, clientStatus: "solved", spouseStatus: "solved" },
      { year: 2027, clientNeed: 120, spouseNeed: 60, clientStatus: "solved", spouseStatus: "solved" },
      { year: 2028, clientNeed: 140, spouseNeed: 70, clientStatus: "solved", spouseStatus: "solved" },
    ]);
  });

  it("does not append rows from a progress event with no row (back-compat guard)", async () => {
    const frames = [
      'event: meta\ndata: {"planStartYear":2026,"planEndYear":2026}\n\n',
      'event: progress\ndata: {"done":0,"total":1}\n\n',
      'event: result\ndata: {"rows":[{"year":2026,"clientNeed":100,"spouseNeed":null,"clientStatus":"solved","spouseStatus":null}]}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFramedResponse(frames)));

    const { result } = renderHook(() =>
      useNeedOverTime(CLIENT_ID, ASSUMPTIONS, true, "base", []),
    );

    // The row-less progress event must not have appended anything — rows
    // stays at the empty accumulator start until the terminal `result`.
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows).toEqual([
      { year: 2026, clientNeed: 100, spouseNeed: null, clientStatus: "solved", spouseStatus: null },
    ]);
  });
});
