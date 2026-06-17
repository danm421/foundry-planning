// src/domain/forge/__tests__/flag.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { isForgeEnabled } from "../flag";

const ORIGINAL = process.env.COPILOT_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.COPILOT_ENABLED;
  else process.env.COPILOT_ENABLED = ORIGINAL;
});

describe("isForgeEnabled", () => {
  it("is true only when COPILOT_ENABLED === 'true'", () => {
    process.env.COPILOT_ENABLED = "true";
    expect(isForgeEnabled()).toBe(true);
  });

  it("is false when unset", () => {
    delete process.env.COPILOT_ENABLED;
    expect(isForgeEnabled()).toBe(false);
  });

  it("is false for any other value (case-sensitive, no truthy coercion)", () => {
    for (const v of ["false", "1", "TRUE", "yes", ""]) {
      process.env.COPILOT_ENABLED = v;
      expect(isForgeEnabled()).toBe(false);
    }
  });
});
