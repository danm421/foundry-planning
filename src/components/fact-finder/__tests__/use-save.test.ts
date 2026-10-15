// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-save.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSave } from "../use-save";
import { SAVE_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import type { ChangeSet, ChangeTicks } from "@/lib/fact-finder/change-set";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

const URL = "/api/clients/c1/imports/i1/fact-finder/save";
const CHANGES: ChangeSet = { builtAtVersion: 5, builtAt: "2026-10-13T10:00:00.000Z", lines: [], notices: [] };
const TICKS: ChangeTicks = { "c1/account": { name: true, value: false } };
const closed: FactFinderState = { ...emptyFactFinderState(), version: 6 };
const fresh: FactFinderState = { ...emptyFactFinderState(), version: 7 };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response;
}

function renderSave() {
  const onSaved = vi.fn();
  const onStale = vi.fn();
  const hook = renderHook(() => useSave({ clientId: "c1", importId: "i1", onSaved, onStale }));
  return { ...hook, onSaved, onStale };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSave", () => {
  it("posts the change list's version and the ticks, shows saving meanwhile, and hands the closed fact finder to onSaved", async () => {
    let release: (res: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result, onSaved, onStale } = renderSave();

    let done = Promise.resolve();
    await act(async () => {
      done = result.current.save(CHANGES, TICKS);
    });
    expect(result.current.saving).toBe(true);
    expect(fetch).toHaveBeenCalledWith(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetVersion: 5, ticks: TICKS }),
    });

    await act(async () => {
      release(reply(200, { factFinder: closed }));
      await done;
    });
    expect(onSaved).toHaveBeenCalledWith(closed);
    expect(onStale).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("ignores a second press while a save is running", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(() => {}));
    const { result } = renderSave();
    await act(async () => {
      void result.current.save(CHANGES, TICKS);
    });
    await act(() => result.current.save(CHANGES, TICKS));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("on a 422 keeps the reason and the line that failed, and adopts nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(422, { error: "Joint Checking: Value must be a number.", lineId: "c1/account" }));
    const { result, onSaved, onStale } = renderSave();
    await act(() => result.current.save(CHANGES, TICKS));
    expect(result.current.error).toEqual({ message: "Joint Checking: Value must be a number.", lineId: "c1/account" });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it("on a 409 hands the fresher fact finder to onStale and keeps the reason, marked stale", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: SAVE_STALE_MESSAGE, factFinder: fresh }));
    const { result, onSaved, onStale } = renderSave();
    await act(() => result.current.save(CHANGES, TICKS));
    expect(onStale).toHaveBeenCalledWith(fresh);
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ message: SAVE_STALE_MESSAGE, stale: true });
  });

  it("on a 409 about one record names its line and calls onStale without a fact finder", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: "“Fidelity IRA” changed since you reviewed — review again.", lineId: "a1/account" }));
    const { result, onStale } = renderSave();
    await act(() => result.current.save(CHANGES, TICKS));
    expect(onStale).toHaveBeenCalledWith(undefined);
    expect(result.current.error).toEqual({ message: "“Fidelity IRA” changed since you reviewed — review again.", lineId: "a1/account", stale: true });
  });

  it("says when the server can't be reached or refuses in another way, and dismiss clears it", async () => {
    const { result } = renderSave();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(() => result.current.save(CHANGES, TICKS));
    expect(result.current.error).toEqual({ message: "Couldn't reach the server. Check your connection." });

    vi.mocked(fetch).mockResolvedValueOnce(reply(500, { error: "The save failed — nothing was changed." }));
    await act(() => result.current.save(CHANGES, TICKS));
    expect(result.current.error).toEqual({ message: "The save failed — nothing was changed." });

    vi.mocked(fetch).mockResolvedValueOnce({ ...reply(502, null), json: async () => Promise.reject(new SyntaxError("bad")) } as Response);
    await act(() => result.current.save(CHANGES, TICKS));
    expect(result.current.error).toEqual({ message: "Couldn't save to the plan (HTTP 502). Nothing was changed." });

    act(() => result.current.dismiss());
    expect(result.current.error).toBeNull();
  });
});
