import { describe, it, expect, expectTypeOf } from "vitest";
import { linkedSourceLabel, linkedSourceOf, type LinkedSource } from "../linked-source";
import type { PortalAccountRow } from "@/lib/portal/contracts";

describe("linkedSourceOf", () => {
  it("reads a Plaid item as Plaid, whatever the source column says", () => {
    expect(linkedSourceOf({ plaidItemId: "item-1", externalProvider: null, source: "orion" })).toBe("plaid");
  });

  it("names each integration from externalProvider", () => {
    for (const provider of ["orion", "schwab", "addepar"] as const) {
      expect(linkedSourceOf({ plaidItemId: null, externalProvider: provider, source: "manual" })).toBe(provider);
    }
  });

  it("falls back to the source column when externalProvider is unset", () => {
    expect(linkedSourceOf({ plaidItemId: null, externalProvider: null, source: "schwab" })).toBe("schwab");
  });

  it("reads an unlinked Plaid account as manual — the FK nulls, the source does not", () => {
    expect(linkedSourceOf({ plaidItemId: null, externalProvider: null, source: "plaid" })).toBeNull();
  });

  it("reads hand-typed and document-extracted accounts as manual", () => {
    expect(linkedSourceOf({ plaidItemId: null, externalProvider: null, source: "manual" })).toBeNull();
    expect(linkedSourceOf({ plaidItemId: null, externalProvider: null, source: "extracted" })).toBeNull();
    expect(linkedSourceOf({ plaidItemId: null })).toBeNull();
  });

  it("labels Plaid as linked and integrations as synced", () => {
    expect(linkedSourceLabel("plaid")).toBe("Linked via Plaid");
    expect(linkedSourceLabel("schwab")).toBe("Synced from Schwab");
  });

  // contracts.ts spells the union out (it may not import); tsc fails here if
  // either side gains a member the other lacks.
  it("matches the portal contract's copy of the union", () => {
    expectTypeOf<PortalAccountRow["linkedSource"]>().toEqualTypeOf<LinkedSource | null>();
  });
});
