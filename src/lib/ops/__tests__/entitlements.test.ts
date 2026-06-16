import { describe, it, expect } from "vitest";
import { collapseActiveOverrides, type OverrideRow } from "../entitlements";

const NOW = new Date("2026-06-15T00:00:00Z");
const row = (over: Partial<OverrideRow>): OverrideRow => ({
  entitlement: "ai_import",
  mode: "grant",
  reason: "r",
  setBy: "user_op",
  expiresAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

describe("collapseActiveOverrides", () => {
  it("keeps the latest row per entitlement by createdAt", () => {
    const rows = [
      row({ mode: "grant", createdAt: new Date("2026-06-01T00:00:00Z") }),
      row({ mode: "revoke", createdAt: new Date("2026-06-10T00:00:00Z") }),
    ];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([
      expect.objectContaining({ entitlement: "ai_import", mode: "revoke" }),
    ]);
  });

  it("drops expired overrides", () => {
    const rows = [row({ expiresAt: new Date("2026-06-10T00:00:00Z") })];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });

  it("treats a null expiry as active", () => {
    expect(collapseActiveOverrides([row({ expiresAt: null })], NOW)).toHaveLength(1);
  });

  it("treats a future expiry as active", () => {
    const rows = [row({ expiresAt: new Date("2026-12-31T00:00:00Z") })];
    expect(collapseActiveOverrides(rows, NOW)).toHaveLength(1);
  });

  it("collapses each entitlement independently, sorted by key", () => {
    const rows = [
      row({ entitlement: "white_label", mode: "grant" }),
      row({ entitlement: "ai_import", mode: "revoke" }),
    ];
    expect(collapseActiveOverrides(rows, NOW).map((o) => o.entitlement)).toEqual([
      "ai_import",
      "white_label",
    ]);
  });

  it("treats an expiry exactly at `now` as expired (<= boundary)", () => {
    const rows = [row({ expiresAt: new Date("2026-06-15T00:00:00Z") })]; // == NOW
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });

  it("defensively skips rows with an invalid mode", () => {
    const rows = [row({ mode: "bogus", entitlement: "ai_import" })];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });
});
