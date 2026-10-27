// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-fact-finder.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SAVE_DEBOUNCE_MS, useFactFinder } from "../use-fact-finder";
import { SAVE_CLOSED_MESSAGE, type PatchFactFinderBody } from "@/lib/fact-finder/api-types";
import { FactFinderOpError, MAX_OPS_PER_SAVE, applyOps, parseOps, type ClientOp, type OpContext } from "@/lib/fact-finder/ops";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFCell } from "@/lib/fact-finder/types";

const URL = "/api/clients/c1/imports/i1/fact-finder";
const ROWS = ["c1", "c2", "c3", "c4", "c5"];

const doc = (value: string): FFCell => ({ value, confidence: 0.9, by: "document", source: { fileId: "f1" } });

/** Five cash accounts read from a document, at version 4. */
function start(): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    version: 4,
    sections: {
      ...s.sections,
      cash: ROWS.map((id) => ({ id, cells: { accountName: doc(`Account ${id}`) }, sourceFileIds: ["f1"] })),
    },
  };
}

const setCell = (rowId: string, columnId: string, value: unknown): ClientOp => ({
  op: "setCell",
  sectionId: "cash",
  rowId,
  columnId,
  value,
});
const cell = (state: FactFinderState, rowId: string, columnId: string) =>
  state.sections.cash.find((r) => r.id === rowId)?.cells[columnId]?.value;

const ctx = (by: OpContext["by"]): OpContext => ({ by, now: new Date().toISOString(), newId: () => crypto.randomUUID() });

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response;
}

/** The PATCH route's compare-and-set over a state the test can also change (a chat reply, a reading). */
function fakeServer(initial: FactFinderState) {
  const server = {
    state: initial,
    /** Every op the server applied, in order. */
    applied: [] as ClientOp[],
    requests: [] as PatchFactFinderBody[],
    /** Per PATCH, in order: fail before applying, or apply and then lose the reply. */
    faults: [] as Array<"network" | "lostReply" | undefined>,
    /** Every PATCH fails before it arrives. */
    offline: false,
    write(ops: ClientOp[], by: OpContext["by"]) {
      server.state = { ...applyOps(server.state, ops, ctx(by)), version: server.state.version + 1 };
    },
  };
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method !== "PATCH") return reply(200, { factFinder: server.state });
    const body = JSON.parse(String(init.body)) as PatchFactFinderBody;
    server.requests.push(body);
    const fault = server.faults.shift();
    if (fault === "network" || server.offline) throw new TypeError("Failed to fetch");
    // The route's own check: at most MAX_OPS_PER_SAVE ops, each well formed.
    try {
      parseOps(body.ops);
    } catch (err) {
      if (err instanceof FactFinderOpError) return reply(400, { error: err.message });
      throw err;
    }
    if (body.baseVersion !== server.state.version) return reply(409, { error: "conflict", factFinder: server.state });
    server.write(body.ops, "advisor");
    server.applied.push(...body.ops);
    if (fault === "lostReply") throw new TypeError("Failed to fetch");
    return reply(200, { version: server.state.version, factFinder: server.state });
  });
  return server;
}

function renderStore(initialState = start()) {
  return renderHook(() => useFactFinder({ clientId: "c1", importId: "i1", initialState }));
}

/** Lets the debounce fire and every reply that follows land. */
const settle = (ms = SAVE_DEBOUNCE_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useFactFinder — saving", () => {
  it("shows an edit at once and sends edits made close together as one batch, 400 ms after the last", async () => {
    const server = fakeServer(start());
    const { result } = renderStore();

    act(() => {
      expect(result.current.apply([setCell("c1", "currentValue", "12,000")])).toBe(true);
    });
    expect(cell(result.current.state, "c1", "currentValue")).toBe(12000);
    await settle(300);
    act(() => {
      result.current.apply([setCell("c1", "last4", "0042")]);
    });
    await settle(300);
    expect(fetch).not.toHaveBeenCalled();

    await settle(100);
    expect(server.requests).toEqual([
      { baseVersion: 4, ops: [setCell("c1", "currentValue", "12,000"), setCell("c1", "last4", "0042")] },
    ]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(URL);
    expect(result.current.error).toBeNull();
    expect(result.current.state).toEqual(server.state);
  });

  it("keeps one request in flight: edits made meanwhile wait, then go on the version it returned", async () => {
    let release: (res: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result } = renderStore();

    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.apply([setCell("c2", "currentValue", 200)]);
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    const afterFirst = { ...applyOps(start(), [setCell("c1", "currentValue", 100)], ctx("advisor")), version: 5 };
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { version: 6, factFinder: { ...afterFirst, version: 6 } }));
    await act(async () => release(reply(200, { version: 5, factFinder: afterFirst })));
    await settle(0);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({
      baseVersion: 5,
      ops: [setCell("c2", "currentValue", 200)],
    });
    expect(result.current.error).toBeNull();
  });

  it("flushNow sends what's queued at once and resolves true once nothing is left to save", async () => {
    const server = fakeServer(start());
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });

    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });

    expect(drained).toBe(true);
    expect(server.applied).toEqual([setCell("c1", "currentValue", 100)]);
    expect(result.current.error).toBeNull();
  });

  it("keeps the edits after a network error or a 429, says so (with Retry-After), and the next flush sends them again", async () => {
    const server = fakeServer(start());
    server.faults.push("network");
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });

    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(false);
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");
    expect(cell(result.current.state, "c1", "currentValue")).toBe(100);

    vi.mocked(fetch).mockResolvedValueOnce(
      reply(429, { error: "Too many edits at once." }, { "retry-after": "12" }),
    );
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(false);
    expect(result.current.error).toBe("Too many edits at once. Retry in 12s.");

    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(true);
    expect(result.current.error).toBeNull();
    expect(server.applied).toEqual([setCell("c1", "currentValue", 100)]);
  });
  it("edits queued while offline all save once it's back, in order, at most 200 to a request (I1)", async () => {
    const server = fakeServer(start());
    server.offline = true;
    const { result } = renderStore();
    const edits = Array.from({ length: 250 }, (_, i) => setCell(ROWS[i % ROWS.length], "currentValue", i));

    // Typed in two spells while "Not saved": each save fails again.
    act(() => {
      for (const op of edits.slice(0, 125)) result.current.apply([op]);
    });
    await settle();
    act(() => {
      for (const op of edits.slice(125)) result.current.apply([op]);
    });
    await settle();
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");

    server.offline = false;
    await act(async () => {
      await result.current.flushNow();
    });

    expect(server.requests.map((r) => r.ops.length)).toEqual([125, 200, 200, 50]);
    expect(server.requests.slice(2).map((r) => r.baseVersion)).toEqual([4, 5]);
    expect(server.applied).toEqual(edits);
    expect(result.current.error).toBeNull();
    expect(result.current.state).toEqual(server.state);
    expect(MAX_OPS_PER_SAVE).toBe(200); // the route's cap, shared
  });

  it("a save that throws unexpectedly says so, and a flush, later saves and flushNow still work", async () => {
    const server = fakeServer(start());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A 409 whose fact finder is malformed: adopting it throws.
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { error: "conflict", factFinder: { version: 99 } }));
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });
    await settle();
    expect(result.current.error).toBe("Something went wrong while saving.");
    expect(logged).toHaveBeenCalledWith("Fact finder save failed unexpectedly:", expect.any(TypeError));
    logged.mockRestore();

    await act(async () => {
      await result.current.flushNow();
    });
    expect(result.current.error).toBeNull();
    expect(server.applied).toEqual([setCell("c1", "currentValue", 100)]);

    act(() => {
      result.current.apply([setCell("c2", "currentValue", 200)]);
    });
    await settle();
    act(() => {
      result.current.apply([setCell("c3", "currentValue", 300)]);
    });
    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(true);
    expect(server.applied).toEqual([
      setCell("c1", "currentValue", 100),
      setCell("c2", "currentValue", 200),
      setCell("c3", "currentValue", 300),
    ]);
    expect(result.current.error).toBeNull();
  });
});

describe("useFactFinder — refusals and conflicts", () => {
  it("refuses an invalid value: apply returns false, the error says why, nothing changes and nothing is sent (RF3)", async () => {
    const initial = start();
    const { result } = renderStore(initial);

    let accepted: boolean | undefined;
    act(() => {
      accepted = result.current.apply([setCell("c1", "currentValue", "abc")]);
    });

    expect(accepted).toBe(false);
    expect(result.current.error).toBe(`"abc" isn't a valid Current value (a dollar amount).`);
    expect(result.current.state).toBe(initial);
    await settle(2000);
    expect(fetch).not.toHaveBeenCalled();

    act(() => result.current.dismiss());
    expect(result.current.error).toBeNull();
  });

  it("a 409 because another tab saved the import takes the saved fact finder and drops the waiting edits — never sends them again", async () => {
    const closed: FactFinderState = { ...start(), version: 5, closed: { at: "2026-10-15T12:00:00.000Z", by: "user_2", saved: [], leftOut: [] } };
    // The gate refuses every edit to a saved import, with the saved fact finder; a second send would wait here for ever.
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply(409, { error: SAVE_CLOSED_MESSAGE, factFinder: closed }))
      .mockImplementation(() => new Promise<Response>(() => {}));
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "custodian", "Chase")]);
    });
    await settle();
    await settle(5_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.current.state.closed).toEqual(closed.closed);
    expect(cell(result.current.state, "c1", "custodian")).toBeUndefined();
    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(true); // nothing left to send
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("a 409 with no fact finder to take (finished in statement chat) shows the refusal and stops — the edits are never sent again", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply(409, { error: SAVE_CLOSED_MESSAGE }))
      .mockImplementation(() => new Promise<Response>(() => {}));
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "custodian", "Chase")]);
    });
    await settle();
    await settle(5_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.current.error).toBe(SAVE_CLOSED_MESSAGE);
    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(true); // nothing left to send
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("on a 409 keeps the edit to a cell nobody else changed and drops the one whose cell changed, with a notice (RF1)", async () => {
    const server = fakeServer(start());
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", "13,000"), setCell("c1", "last4", "0042")]);
    });
    // A chat reply corrects the same balance before the batch arrives.
    server.write([setCell("c1", "currentValue", 12500)], "chat");

    await settle();

    expect(server.requests.map((r) => r.baseVersion)).toEqual([4, 5]);
    expect(server.applied).toEqual([setCell("c1", "last4", "0042")]);
    expect(cell(result.current.state, "c1", "currentValue")).toBe(12500);
    expect(cell(result.current.state, "c1", "last4")).toBe("0042");
    expect(result.current.notice).toMatch(/weren't kept/);
    expect(result.current.error).toBeNull();

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  it("30 edits across 10 cells, through a 409 and a network error: the server takes every edit once, in order (RF2)", async () => {
    const server = fakeServer(start());
    const { result } = renderStore();
    const round = (n: number) =>
      ROWS.flatMap((rowId, i) => [
        setCell(rowId, "currentValue", n * 1000 + i),
        setCell(rowId, "last4", `${n}${i}00`),
      ]);
    const typeRound = (n: number) =>
      act(() => {
        for (const op of round(n)) result.current.apply([op]);
      });

    typeRound(1);
    server.write([setCell("c1", "custodian", "Chase")], "chat"); // → the first batch gets a 409
    server.faults.push(undefined, "network"); // → its resend fails
    await settle();
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");

    typeRound(2);
    await settle();
    typeRound(3);
    await settle();

    expect(server.applied).toEqual([...round(1), ...round(2), ...round(3)]);
    expect(server.requests.map((r) => r.baseVersion)).toEqual([4, 5, 5, 6]);
    ROWS.forEach((rowId, i) => {
      expect(cell(server.state, rowId, "currentValue")).toBe(3000 + i);
      expect(cell(server.state, rowId, "last4")).toBe(`3${i}00`);
    });
    expect(cell(result.current.state, "c1", "custodian")).toBe("Chase");
    expect(result.current.notice).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("a batch the server took but whose reply was lost is not applied twice and raises no notice", async () => {
    const server = fakeServer(start());
    server.faults.push("lostReply");
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100), setCell("c2", "currentValue", 200)]);
    });
    await settle();
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");

    // Typed after that failed save: the same cell again, and a new one.
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 150), setCell("c3", "currentValue", 300)]);
    });
    await settle();

    // The resend (base 4) gets a 409; only the edits the server hadn't seen go again.
    expect(server.requests.map((r) => r.baseVersion)).toEqual([4, 4, 5]);
    expect(server.applied).toEqual([
      setCell("c1", "currentValue", 100),
      setCell("c2", "currentValue", 200),
      setCell("c1", "currentValue", 150),
      setCell("c3", "currentValue", 300),
    ]);
    expect(result.current.notice).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toEqual(server.state);
  });

  it("on a 400 drops that batch, shows the server's message and re-reads the fact finder", async () => {
    const fresh = { ...start(), version: 6 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply(400, { error: "That row isn't in Cash Accounts any more." }))
      .mockResolvedValueOnce(reply(200, { factFinder: fresh }));
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });

    await settle();

    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      [URL, "PATCH"],
      [URL, "GET"],
    ]);
    expect(result.current.error).toBe("That row isn't in Cash Accounts any more.");
    expect(result.current.state).toBe(fresh);
    let drained: boolean | undefined;
    await act(async () => {
      drained = await result.current.flushNow();
    });
    expect(drained).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("adopt re-applies pending edits on a newer fact finder and ignores an older one", async () => {
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });

    // A reading added a sixth account.
    const read = start();
    const c6 = { id: "c6", cells: { accountName: doc("CD") }, sourceFileIds: ["f2"] };
    const newer = { ...read, version: 7, sections: { ...read.sections, cash: [...read.sections.cash, c6] } };
    act(() => result.current.adopt(newer));
    expect(result.current.state.sections.cash.map((r) => r.id)).toEqual([...ROWS, "c6"]);
    expect(cell(result.current.state, "c1", "currentValue")).toBe(100);

    act(() => result.current.adopt({ ...start(), version: 5 }));
    expect(result.current.state.sections.cash).toHaveLength(6);

    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { version: 8, factFinder: { ...result.current.state, version: 8 } }));
    await settle();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      baseVersion: 7,
      ops: [setCell("c1", "currentValue", 100)],
    });
  });
  it("once a newer fact finder already holds every unsaved edit, the failure clears and a flush sends nothing", async () => {
    const server = fakeServer(start());
    server.faults.push("lostReply");
    const { result } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });
    await settle();
    expect(result.current.error).toBe("Couldn't reach the server. Check your connection.");
    expect(fetch).toHaveBeenCalledTimes(1);

    // A chat reply's fact finder: the server took the edit, so nothing is left to save.
    act(() => result.current.adopt(server.state));
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBeNull();
    expect(cell(result.current.state, "c1", "currentValue")).toBe(100);

    await act(async () => {
      await result.current.flushNow();
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});

describe("useFactFinder — leaving the page", () => {
  it("hands unsaved edits to the browser with keepalive on pagehide and on unmount", () => {
    vi.mocked(fetch).mockResolvedValue(reply(200, {}));
    const { result, unmount } = renderStore();
    act(() => {
      result.current.apply([setCell("c1", "currentValue", 100)]);
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "PATCH", keepalive: true }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      baseVersion: 4,
      ops: [setCell("c1", "currentValue", 100)],
    });

    unmount();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1][1]).toEqual(expect.objectContaining({ keepalive: true }));
  });

  it("hands over at most 200 edits on pagehide (the route refuses more), the oldest first", () => {
    vi.mocked(fetch).mockResolvedValue(reply(200, {}));
    const { result } = renderStore();
    const edits = Array.from({ length: 250 }, (_, i) => setCell(ROWS[i % ROWS.length], "currentValue", i));
    act(() => {
      for (const op of edits) result.current.apply([op]);
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      baseVersion: 4,
      ops: edits.slice(0, 200),
    });
  });
});
