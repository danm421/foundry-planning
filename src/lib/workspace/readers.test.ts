// src/lib/workspace/readers.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceConnection } from "./connections";
import type { WorkspaceEvent, WorkspaceProvider, WorkspaceTodo } from "./types";
import type { WorkspaceProviderAdapter } from "./provider-adapter";
import { ProviderRequestError, ProviderThrottledError, WorkspaceReconnectRequiredError } from "./errors";
import { ACCOUNT_DEADLINE_MS, readTodos, readWeek, resolveDisplayZone } from "./readers";

function conn(id: string, provider: WorkspaceProvider, status: WorkspaceConnection["status"] = "connected") {
  return { id, provider, status, externalEmail: `${id}@secret-mail.test` } as WorkspaceConnection;
}

function event(id: string, over: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  return {
    id,
    subject: id,
    start: "2026-11-02T09:00",
    end: "2026-11-02T10:00",
    isAllDay: false,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: [],
    meetingUrl: null,
    iCalUid: null,
    webLink: "",
    ...over,
  };
}

function todo(id: string, provider: WorkspaceProvider): WorkspaceTodo {
  return { provider, id, listId: "l", title: id, dueDate: null, notes: "", notesAreHtml: false };
}

type Fake = {
  tz?: string | null | Error;
  events?: WorkspaceEvent[] | Error;
  todos?: WorkspaceTodo[] | Error;
};

function fake(f: Fake = {}) {
  const run = <T>(v: T | Error | undefined, dflt: T) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? dflt));
  return {
    getTimeZone: vi.fn(() => run(f.tz, null)),
    listEvents: vi.fn(() => run(f.events, [])),
    listOpenTodos: vi.fn(() => run(f.todos, [])),
  };
}

function lookup(by: Record<string, ReturnType<typeof fake>>, conns: WorkspaceConnection[]) {
  // adapters are looked up per provider; tests use one provider per connection
  const byProvider = Object.fromEntries(conns.map((c) => [c.provider, by[c.id]]));
  return (p: WorkspaceProvider) => byProvider[p] as unknown as WorkspaceProviderAdapter;
}

describe("readers", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe("resolveDisplayZone", () => {
    it("uses the first account that reports a zone", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake({ tz: null }), b: fake({ tz: "America/Chicago" }) };
      expect(await resolveDisplayZone([a, b], lookup(fakes, [a, b]))).toEqual({
        timeZone: "America/Chicago",
        fallback: false,
      });
    });

    it("falls back to UTC when every account is null", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake(), b: fake() };
      expect(await resolveDisplayZone([a, b], lookup(fakes, [a, b]))).toEqual({ timeZone: "UTC", fallback: true });
    });

    it("skips an account whose getTimeZone throws, and (M4) logs its ids, never the message or address", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake({ tz: new Error("boom secret") }), b: fake({ tz: "Europe/Paris" }) };
      expect((await resolveDisplayZone([a, b], lookup(fakes, [a, b]))).timeZone).toBe("Europe/Paris");
      expect(warn).toHaveBeenCalledTimes(1);
      const out = JSON.stringify(warn.mock.calls);
      expect(out).toContain('"connectionId":"a"');
      expect(out).toContain('"name":"Error"');
      expect(out).not.toContain("secret");
    });

    it("(R17) treats an invalid zone like null", async () => {
      const a = conn("a", "microsoft");
      const b = conn("b", "google");
      const fakes = { a: fake({ tz: "tzone://Microsoft/Custom" }), b: fake({ tz: "America/Chicago" }) };
      expect(await resolveDisplayZone([a, b], lookup(fakes, [a, b]))).toEqual({
        timeZone: "America/Chicago",
        fallback: false,
      });
    });

    it("never asks a needs_reconnect account", async () => {
      const a = conn("a", "google", "needs_reconnect");
      const fakes = { a: fake({ tz: "Asia/Tokyo" }) };
      expect((await resolveDisplayZone([a], lookup(fakes, [a]))).fallback).toBe(true);
      expect(fakes.a.getTimeZone).not.toHaveBeenCalled();
    });
  });

  describe("readWeek", () => {
    it("mixes ok, throttled and already-needs_reconnect accounts", async () => {
      const g = conn("g", "google");
      const m = conn("m", "microsoft");
      const x = conn("x", "microsoft", "needs_reconnect");
      const fakes = {
        g: fake({ tz: "America/Chicago", events: [event("e1"), event("e2", { start: "2026-11-03T09:00" })] }),
        m: fake({ events: new ProviderThrottledError("microsoft", "req") }),
        x: fake({ events: [event("never")] }),
      };
      // two microsoft connections share a provider key; give the lookup a per-call router
      const adapters = (p: WorkspaceProvider) => (p === "google" ? fakes.g : fakes.m) as unknown as WorkspaceProviderAdapter;
      const res = await readWeek({ connections: [g, m, x], startDate: "2026-11-02", days: 7, adapters });

      expect(res.events).toHaveLength(2);
      expect(res.events.every((e) => e.connectionId === "g" && e.provider === "google")).toBe(true);
      expect(res.accounts).toEqual([
        { connectionId: "g", error: null },
        { connectionId: "m", error: "throttled" },
        { connectionId: "x", error: "needs_reconnect" },
      ]);
      // x is stored needs_reconnect: m's adapter saw exactly one listEvents call (m's own)
      expect(fakes.m.listEvents).toHaveBeenCalledTimes(1);
    });

    it("reads every account in the first available zone", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake({ tz: null }), b: fake({ tz: "America/Chicago" }) };
      const res = await readWeek({ connections: [a, b], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a, b]) });
      expect(res.timeZone).toBe("America/Chicago");
      expect(res.timeZoneFallback).toBe(false);
      expect(fakes.a.listEvents).toHaveBeenCalledWith(a, { startDate: "2026-11-02", days: 7, timeZone: "America/Chicago" });
      expect(fakes.b.listEvents).toHaveBeenCalledWith(b, { startDate: "2026-11-02", days: 7, timeZone: "America/Chicago" });
    });

    it("reports the UTC fallback", async () => {
      const a = conn("a", "google");
      const fakes = { a: fake() };
      const res = await readWeek({ connections: [a], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a]) });
      expect(res).toMatchObject({ timeZone: "UTC", timeZoneFallback: true });
    });

    it("shows one copy of a meeting that is on two accounts", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const shared = { iCalUid: "uid-1", start: "2026-11-02T09:00" };
      const fakes = {
        a: fake({ events: [event("ga", shared)] }),
        b: fake({ events: [event("mb", shared)] }),
      };
      const res = await readWeek({ connections: [a, b], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a, b]) });
      expect(res.events).toHaveLength(1);
      expect(res.events[0].connectionId).toBe("a");
    });

    it("(I1) a meeting shared with a hidden account is listed via the shown one, even when the hidden copy would win", async () => {
      // `a` is connected first, so its copy wins the dedupe when both are read.
      const a = conn("a", "microsoft");
      const b = conn("b", "google");
      const shared = { iCalUid: "uid-1", start: "2026-11-02T09:00" };
      const fakes = {
        a: fake({ tz: "America/Chicago", events: [event("outlook-copy", shared)] }),
        b: fake({ events: [event("google-copy", shared)] }),
      };
      const res = await readWeek({
        connections: [a, b],
        hidden: new Set(["a"]),
        startDate: "2026-11-02",
        days: 7,
        adapters: lookup(fakes, [a, b]),
      });
      expect(res.events.map((e) => [e.id, e.connectionId])).toEqual([["google-copy", "b"]]);
      expect(fakes.a.listEvents).not.toHaveBeenCalled();
      expect(res.accounts).toEqual([{ connectionId: "b", error: null }]);
      // The zone is still the first-connected address's, hidden or not.
      expect(res.timeZone).toBe("America/Chicago");
    });

    it("(I1) a hidden id that isn't one of the connections changes nothing", async () => {
      const a = conn("a", "microsoft");
      const b = conn("b", "google");
      const fakes = { a: fake({ events: [event("ma")] }), b: fake({ events: [event("gb", { start: "2026-11-03T09:00" })] }) };
      const res = await readWeek({
        connections: [a, b],
        hidden: new Set(["someone-elses-connection"]),
        startDate: "2026-11-02",
        days: 7,
        adapters: lookup(fakes, [a, b]),
      });
      expect(res.events.map((e) => e.connectionId)).toEqual(["a", "b"]);
      expect(res.accounts.map((x) => x.connectionId)).toEqual(["a", "b"]);
    });

    it("maps a reconnect error and an unknown error, logging no message", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = {
        a: fake({ events: new WorkspaceReconnectRequiredError() }),
        b: fake({ events: new Error("boom secret") }),
      };
      const res = await readWeek({ connections: [a, b], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a, b]) });
      expect(res.accounts.map((x) => x.error)).toEqual(["needs_reconnect", "unavailable"]);
      const out = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(out).not.toContain("secret");
      expect(out).toContain('"microsoft"');
      expect(out).toContain('"b"');
    });

    it("(R15) logs a Google failure's code and status", async () => {
      const a = conn("a", "google");
      const fakes = { a: fake({ events: new ProviderRequestError("google", 400, "badRequest", null) }) };
      await readWeek({ connections: [a], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a]) });
      expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).toContain("badRequest");
    });
  });

  describe("(I2) a provider that never answers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const never = () => new Promise<never>(() => {});

    /** Settles `p` across the deadline, checking it was still pending just before it. */
    async function acrossTheDeadline<T>(p: Promise<T>): Promise<T> {
      let settled = false;
      void p.then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(ACCOUNT_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      return p;
    }

    it("is 15 seconds per account", () => {
      expect(ACCOUNT_DEADLINE_MS).toBe(15_000);
    });

    it("the week: the hung account is unavailable, the other's meetings still come back, and only ids are logged", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake({ tz: "America/Chicago" }), b: fake({ events: [event("mb")] }) };
      fakes.a.listEvents.mockImplementation(never);
      const res = await acrossTheDeadline(
        readWeek({ connections: [a, b], startDate: "2026-11-02", days: 7, adapters: lookup(fakes, [a, b]) }),
      );
      expect(res.events.map((e) => [e.id, e.connectionId])).toEqual([["mb", "b"]]);
      expect(res.accounts).toEqual([
        { connectionId: "a", error: "unavailable" },
        { connectionId: "b", error: null },
      ]);
      const out = JSON.stringify(warn.mock.calls);
      expect(out).toContain('"connectionId":"a"');
      expect(out).toContain('"provider":"google"');
      expect(out).not.toContain("secret-mail");
    });

    it("the to-dos: the hung account is unavailable, the other's to-dos still come back", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake(), b: fake({ todos: [todo("t1", "microsoft")] }) };
      fakes.a.listOpenTodos.mockImplementation(never);
      expect(await acrossTheDeadline(readTodos({ connections: [a, b], adapters: lookup(fakes, [a, b]) }))).toEqual([
        { connectionId: "a", provider: "google", todos: null, error: "unavailable" },
        { connectionId: "b", provider: "microsoft", todos: [todo("t1", "microsoft")], error: null },
      ]);
    });

    it("the zone: a hung getTimeZone falls through to the next account, and is logged", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const fakes = { a: fake(), b: fake({ tz: "Europe/Paris" }) };
      fakes.a.getTimeZone.mockImplementation(never);
      expect(await acrossTheDeadline(resolveDisplayZone([a, b], lookup(fakes, [a, b])))).toEqual({
        timeZone: "Europe/Paris",
        fallback: false,
      });
      expect(JSON.stringify(warn.mock.calls)).toContain('"connectionId":"a"');
    });
  });

  describe("readTodos", () => {
    it("returns null todos for the account that failed", async () => {
      const a = conn("a", "google");
      const b = conn("b", "microsoft");
      const x = conn("x", "microsoft", "needs_reconnect");
      const fakes = { a: fake({ todos: [todo("t1", "google")] }), b: fake({ todos: new Error("boom") }), x: fake() };
      const adapters = (p: WorkspaceProvider) => (p === "google" ? fakes.a : fakes.b) as unknown as WorkspaceProviderAdapter;
      expect(await readTodos({ connections: [a, b, x], adapters })).toEqual([
        { connectionId: "a", provider: "google", todos: [todo("t1", "google")], error: null },
        { connectionId: "b", provider: "microsoft", todos: null, error: "unavailable" },
        { connectionId: "x", provider: "microsoft", todos: null, error: "needs_reconnect" },
      ]);
    });
  });
});
