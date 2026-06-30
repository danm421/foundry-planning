import { describe, it, expect, vi } from "vitest";
import { singleFlight, inflightCount } from "./single-flight";

/** A promise whose resolve/reject we control, for deterministic timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleFlight", () => {
  it("coalesces concurrent calls for the same key into one compute", async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);

    const a = singleFlight("k", fn);
    const b = singleFlight("k", fn);

    // Both joined the same in-flight run — fn ran exactly once.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inflightCount()).toBe(1);

    d.resolve("result");
    await expect(a).resolves.toBe("result");
    await expect(b).resolves.toBe("result");
    // Settling clears the entry.
    expect(inflightCount()).toBe(0);
  });

  it("runs different keys independently", async () => {
    const fn = vi.fn(async (v: string) => v);
    const [x, y] = await Promise.all([
      singleFlight("a", () => fn("a")),
      singleFlight("b", () => fn("b")),
    ]);
    expect(x).toBe("a");
    expect(y).toBe("b");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("recomputes after the prior run settles (no stale replay)", async () => {
    const fn = vi.fn(async () => "v");
    await singleFlight("k", fn);
    await singleFlight("k", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry on failure so the next call retries", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(singleFlight("k", failing)).rejects.toThrow("boom");
    expect(inflightCount()).toBe(0);

    const ok = vi.fn(async () => "ok");
    await expect(singleFlight("k", ok)).resolves.toBe("ok");
  });

  it("a joiner sees the failure of the shared run", async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const a = singleFlight("k", fn);
    const b = singleFlight("k", fn);
    expect(fn).toHaveBeenCalledTimes(1);

    d.reject(new Error("shared-failure"));
    await expect(a).rejects.toThrow("shared-failure");
    await expect(b).rejects.toThrow("shared-failure");
    expect(inflightCount()).toBe(0);
  });
});
