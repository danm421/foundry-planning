import { describe, it, expect, vi } from "vitest";
import { memoizeByValue } from "../eval-cache";

describe("memoizeByValue", () => {
  it("computes once per distinct value, returns cached entry on repeat", async () => {
    const compute = vi.fn(async (v: number) => ({ pos: v / 100 }));
    const memo = memoizeByValue(compute);

    const a = await memo(60);
    const b = await memo(60); // repeat → cached
    const c = await memo(72);

    expect(a).toBe(b);              // same object reference (cached)
    expect(c).not.toBe(a);
    expect(compute).toHaveBeenCalledTimes(2); // 60 and 72 only
  });
});
