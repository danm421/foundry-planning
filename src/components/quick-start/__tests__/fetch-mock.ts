// Shared typed fetch mock for Quick Start step tests (not a test file itself).
import { vi } from "vitest";

export type FetchCall = [string, { method?: string; body: string }];

/** Installs a resolved-ok fetch mock on global and returns it. */
export function mockFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new-id" }) });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Reads the recorded fetch calls with url + options typed. */
export function fetchCalls(): FetchCall[] {
  return (global.fetch as unknown as { mock: { calls: FetchCall[] } }).mock.calls;
}

/** Finds the first call whose url matches the predicate (throws if none). */
export function findCall(pred: (url: string) => boolean): FetchCall {
  const call = fetchCalls().find((c) => pred(String(c[0])));
  if (!call) throw new Error("no matching fetch call");
  return call;
}
