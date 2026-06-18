import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { withOutputRetry } from "../with-output-retry";

const schema = z.object({ median: z.number() });

describe("withOutputRetry", () => {
  it("returns the validated payload on first success", async () => {
    const fn = vi.fn().mockResolvedValue({ median: 5 });
    const out = await withOutputRetry(fn, schema);
    expect(JSON.parse(out).median).toBe(5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on invalid output, then succeeds", async () => {
    const fn = vi.fn().mockResolvedValueOnce({ wrong: true }).mockResolvedValueOnce({ median: 7 });
    const out = await withOutputRetry(fn, schema);
    expect(JSON.parse(out).median).toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns a safe error after one failed retry (hard cap)", async () => {
    const fn = vi.fn().mockResolvedValue({ wrong: true });
    const out = await withOutputRetry(fn, schema);
    expect(out).toMatch(/couldn't|error/i);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
