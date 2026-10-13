// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-review.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReview } from "../use-review";
import { REVIEW_READING_MESSAGE, REVIEW_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import type { ChangeSet } from "@/lib/fact-finder/change-set";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

const URL = "/api/clients/c1/imports/i1/fact-finder/review";
const CHANGES: ChangeSet = { builtAtVersion: 5, builtAt: "2026-10-13T10:00:00.000Z", lines: [], notices: [] };
const reviewed: FactFinderState = { ...emptyFactFinderState(), version: 5, changeSet: CHANGES };
const fresh: FactFinderState = { ...emptyFactFinderState(), version: 6 };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response;
}

function renderReview(flushed = true) {
  const flushNow = vi.fn(async () => flushed);
  const adopt = vi.fn();
  const hook = renderHook(() => useReview({ clientId: "c1", importId: "i1", flushNow, adopt }));
  return { ...hook, flushNow, adopt };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useReview", () => {
  it("saves typed edits first, then posts the review and adopts the fact finder it answers with", async () => {
    let release: (res: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result, flushNow, adopt } = renderReview();

    let done = Promise.resolve();
    await act(async () => {
      done = result.current.review();
    });
    expect(result.current.reviewing).toBe(true);
    expect(fetch).toHaveBeenCalledWith(URL, { method: "POST" });
    expect(flushNow.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[0]);

    await act(async () => {
      release(reply(200, { factFinder: reviewed }));
      await done;
    });
    expect(adopt).toHaveBeenCalledWith(reviewed);
    expect(result.current.reviewing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("doesn't review while typed edits are still unsaved, and says why", async () => {
    const { result, adopt } = renderReview(false);
    await act(() => result.current.review());
    expect(fetch).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Your latest edits haven't saved yet — try again once they're saved.");
    expect(result.current.reviewing).toBe(false);
  });

  it.each([
    ["links it dropped", "2 links pointed at records that are no longer on the plan — check them and review again."],
    ["a fact finder that changed meanwhile", REVIEW_STALE_MESSAGE],
  ])("on a 409 with %s, adopts the fact finder it sends and shows the reason", async (_case, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: message, factFinder: fresh, rows: ["Joint Checking"] }));
    const { result, adopt } = renderReview();
    await act(() => result.current.review());
    expect(adopt).toHaveBeenCalledWith(fresh);
    expect(result.current.error).toBe(message);
  });

  it("on a 409 without a fact finder shows the reason and adopts nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: REVIEW_READING_MESSAGE }));
    const { result, adopt } = renderReview();
    await act(() => result.current.review());
    expect(adopt).not.toHaveBeenCalled();
    expect(result.current.error).toBe(REVIEW_READING_MESSAGE);
  });

  it("says when the server can't be reached or refuses, with Retry-After when it gives one", async () => {
    const { result, adopt } = renderReview();

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(() => result.current.review());
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");

    vi.mocked(fetch).mockResolvedValueOnce(reply(429, { error: "Too many requests." }, { "retry-after": "30" }));
    await act(() => result.current.review());
    expect(result.current.error).toBe("Too many requests. Retry in 30s.");

    vi.mocked(fetch).mockResolvedValueOnce({ ...reply(500, null), json: async () => Promise.reject(new SyntaxError("bad json")) } as Response);
    await act(() => result.current.review());
    expect(result.current.error).toBe("Couldn't review the changes (HTTP 500).");
    expect(adopt).not.toHaveBeenCalled();
    expect(result.current.reviewing).toBe(false);
  });

  it("dismiss clears the message, and so does the next review", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: REVIEW_READING_MESSAGE }));
    const { result } = renderReview();
    await act(() => result.current.review());
    act(() => result.current.dismiss());
    expect(result.current.error).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: REVIEW_READING_MESSAGE }));
    await act(() => result.current.review());
    let release: (res: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    let done = Promise.resolve();
    await act(async () => {
      done = result.current.review();
    });
    expect(result.current.error).toBeNull();
    await act(async () => {
      release(reply(200, { factFinder: reviewed }));
      await done;
    });
  });
});
