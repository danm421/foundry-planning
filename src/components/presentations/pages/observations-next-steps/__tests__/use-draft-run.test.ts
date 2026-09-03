// @vitest-environment jsdom
// Hook-level, not panel-level: nothing in the panel calls `clear()` yet — the
// Clear affordance lives in the TASK 13 region — so a panel test would have to
// invent a button Task 13 then replaces. `clear` is part of the cross-task
// contract, so it is tested where that contract lives. Fake timers stay
// isolated in this file for the same reason.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDraftRun } from "../use-draft-run";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const RUNS = `/api/clients/${CLIENT_ID}/observations/draft-runs`;

/** A run that never leaves "queued", so the poll keeps rescheduling itself. */
function installPollingFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.endsWith("/draft-runs") && method === "POST") {
        return { ok: true, status: 202, json: async () => ({ runId: "run-1" }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "queued", error: null, scenarioId: null, suggestions: null }),
      } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDraftRun", () => {
  it("clear() cancels a run that is still polling", async () => {
    const calls = installPollingFetch();
    const polls = () => calls.filter((c) => c === `GET ${RUNS}/run-1`).length;
    const { result, unmount } = renderHook(() => useDraftRun(CLIENT_ID));

    await act(async () => {
      await result.current.start("observation");
    });
    // The effect's first tick fires immediately when `active` is set — no
    // timer involved — so one poll has already gone out.
    await act(async () => {});
    expect(polls()).toBe(1);
    expect(result.current.drafting).toBe(true);

    act(() => {
      result.current.clear();
    });
    expect(result.current.drafting).toBe(false);
    expect(result.current.result).toBeNull();

    // Three poll intervals of silence. If `clear` dropped only the result, the
    // effect would survive and these would record further GETs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(polls()).toBe(1);

    unmount();
  });
});
