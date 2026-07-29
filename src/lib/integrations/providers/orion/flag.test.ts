import { afterEach, describe, expect, it } from "vitest";
import { isOrionEnabled } from "./flag";

const original = process.env.ORION_ENABLED;
afterEach(() => {
  process.env.ORION_ENABLED = original;
});

describe("isOrionEnabled", () => {
  it("is false when unset", () => {
    delete process.env.ORION_ENABLED;
    expect(isOrionEnabled()).toBe(false);
  });

  it.each(["1", "yes", "TRUE", ""])("is false for %s (strict equality)", (v) => {
    process.env.ORION_ENABLED = v;
    expect(isOrionEnabled()).toBe(false);
  });

  it("is true only for the exact string true", () => {
    process.env.ORION_ENABLED = "true";
    expect(isOrionEnabled()).toBe(true);
  });
});
