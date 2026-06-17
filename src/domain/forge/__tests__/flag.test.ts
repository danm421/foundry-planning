// src/domain/forge/__tests__/flag.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { isForgeEnabled } from "../flag";

const ORIGINAL_FORGE = process.env.FORGE_ENABLED;
const ORIGINAL_COPILOT = process.env.COPILOT_ENABLED;

function restore(key: "FORGE_ENABLED" | "COPILOT_ENABLED", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("FORGE_ENABLED", ORIGINAL_FORGE);
  restore("COPILOT_ENABLED", ORIGINAL_COPILOT);
});

describe("isForgeEnabled", () => {
  it("is true only when FORGE_ENABLED === 'true'", () => {
    delete process.env.COPILOT_ENABLED;
    process.env.FORGE_ENABLED = "true";
    expect(isForgeEnabled()).toBe(true);
  });

  it("is false when both unset", () => {
    delete process.env.FORGE_ENABLED;
    delete process.env.COPILOT_ENABLED;
    expect(isForgeEnabled()).toBe(false);
  });

  it("falls back to legacy COPILOT_ENABLED when FORGE_ENABLED is unset (dual-read)", () => {
    delete process.env.FORGE_ENABLED;
    process.env.COPILOT_ENABLED = "true";
    expect(isForgeEnabled()).toBe(true);
  });

  it("FORGE_ENABLED wins over COPILOT_ENABLED when both set", () => {
    process.env.FORGE_ENABLED = "false";
    process.env.COPILOT_ENABLED = "true";
    expect(isForgeEnabled()).toBe(false);
  });

  it("is false for any other value (case-sensitive, no truthy coercion)", () => {
    delete process.env.COPILOT_ENABLED;
    for (const v of ["false", "1", "TRUE", "yes", ""]) {
      process.env.FORGE_ENABLED = v;
      expect(isForgeEnabled()).toBe(false);
    }
  });
});
