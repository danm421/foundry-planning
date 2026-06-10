import { describe, it, expect } from "vitest";
import { canExtract } from "../extract-gate";
import { AI_IMPORT_FREE_QUOTA } from "../entitlements";

describe("canExtract", () => {
  it("allows when the firm holds the ai_import entitlement (any usage)", () => {
    expect(
      canExtract({ entitlements: ["ai_import"], aiImportsUsed: 999 }),
    ).toBe(true);
  });

  it("allows on free-quota headroom even without the entitlement", () => {
    expect(
      canExtract({ entitlements: [], aiImportsUsed: AI_IMPORT_FREE_QUOTA - 1 }),
    ).toBe(true);
  });

  it("blocks when quota is exhausted and the entitlement is absent", () => {
    expect(
      canExtract({ entitlements: [], aiImportsUsed: AI_IMPORT_FREE_QUOTA }),
    ).toBe(false);
  });

  it("blocks when entitlements is undefined and quota exhausted", () => {
    expect(
      canExtract({ entitlements: undefined, aiImportsUsed: AI_IMPORT_FREE_QUOTA + 5 }),
    ).toBe(false);
  });
});
