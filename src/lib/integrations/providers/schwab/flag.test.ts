import { afterEach, describe, expect, it } from "vitest";
import { isSchwabEnabled } from "./flag";

const original = process.env.SCHWAB_ENABLED;
afterEach(() => {
  process.env.SCHWAB_ENABLED = original;
});

describe("isSchwabEnabled", () => {
  it("is false when unset", () => {
    delete process.env.SCHWAB_ENABLED;
    expect(isSchwabEnabled()).toBe(false);
  });

  it.each(["1", "yes", "TRUE", ""])("is false for %s (strict equality)", (v) => {
    process.env.SCHWAB_ENABLED = v;
    expect(isSchwabEnabled()).toBe(false);
  });

  it("is true only for the exact string true", () => {
    process.env.SCHWAB_ENABLED = "true";
    expect(isSchwabEnabled()).toBe(true);
  });
});
