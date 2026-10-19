import { describe, it, expect, expectTypeOf } from "vitest";
import {
  isFirmSynced,
  linkedSourceLabel,
  linkedSourceOf,
  linkedStatusLines,
  linkedStatusOf,
  type LinkedStatus,
} from "../linked-source";
import type { PortalLinkedStatus } from "@/lib/portal/contracts";

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

  // contracts.ts spells the shape out (it may not import); tsc fails here if
  // either side gains a member the other lacks.
  it("matches the portal contract's copy of the shape", () => {
    expectTypeOf<PortalLinkedStatus>().toEqualTypeOf<LinkedStatus>();
  });
});

describe("isFirmSynced", () => {
  it("is true for an account a firm integration keeps current", () => {
    expect(isFirmSynced({ plaidItemId: null, externalProvider: "orion", source: "orion" })).toBe(true);
    expect(isFirmSynced({ plaidItemId: null, externalProvider: null, source: "addepar" })).toBe(true);
  });

  it("is false for the client's own Plaid link and for hand-typed accounts", () => {
    expect(isFirmSynced({ plaidItemId: "item-1", externalProvider: null, source: "plaid" })).toBe(false);
    expect(isFirmSynced({ plaidItemId: null, externalProvider: null, source: "manual" })).toBe(false);
  });
});

describe("linkedStatusOf", () => {
  const SYNCED = new Date("2026-10-14T19:42:00Z");
  const REFRESHED = new Date("2026-10-15T12:00:00Z");

  it("dates a Plaid account by its bank connection's last refresh, not the account column", () => {
    expect(
      linkedStatusOf({
        plaidItemId: "item-1",
        lastSyncedAt: SYNCED,
        plaidRefreshedAt: REFRESHED,
        plaidRefreshError: null,
      }),
    ).toEqual({ source: "plaid", syncedAt: "2026-10-15T12:00:00.000Z", issue: null });
  });

  it("dates an integration account by its own sync stamp", () => {
    expect(
      linkedStatusOf({ plaidItemId: null, externalProvider: "schwab", lastSyncedAt: SYNCED }),
    ).toEqual({ source: "schwab", syncedAt: "2026-10-14T19:42:00.000Z", issue: null });
  });

  it("flags a Plaid link that needs the client to log in again", () => {
    for (const code of ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"]) {
      expect(
        linkedStatusOf({ plaidItemId: "item-1", plaidRefreshedAt: REFRESHED, plaidRefreshError: code })?.issue,
      ).toBe("reconnect");
    }
  });

  it("flags a Plaid link whose access was revoked", () => {
    expect(
      linkedStatusOf({ plaidItemId: "item-1", plaidRefreshError: "USER_PERMISSION_REVOKED" })?.issue,
    ).toBe("revoked");
  });

  // A product-config code (e.g. liabilities not enabled) is stored on the item
  // while balances keep refreshing — it is not a broken link.
  it("does not flag an error the client cannot fix", () => {
    expect(
      linkedStatusOf({ plaidItemId: "item-1", plaidRefreshedAt: REFRESHED, plaidRefreshError: "INVALID_PRODUCT" })
        ?.issue,
    ).toBeNull();
  });

  it("leaves the time null when the connection has never synced", () => {
    expect(linkedStatusOf({ plaidItemId: "item-1" })).toEqual({ source: "plaid", syncedAt: null, issue: null });
    expect(linkedStatusOf({ plaidItemId: null, externalProvider: "orion", lastSyncedAt: null })?.syncedAt).toBeNull();
  });

  it("returns null for a hand-entered account", () => {
    expect(linkedStatusOf({ plaidItemId: null, source: "manual", lastSyncedAt: SYNCED })).toBeNull();
  });
});

describe("linkedStatusLines", () => {
  const fmt = (iso: string) => `<${iso}>`;

  it("names the source, then when it last updated", () => {
    expect(
      linkedStatusLines({ source: "orion", syncedAt: "2026-10-14T19:42:00.000Z", issue: null }, fmt),
    ).toEqual(["Synced from Orion", "Last updated <2026-10-14T19:42:00.000Z>"]);
  });

  it("says so when the connection has not synced yet", () => {
    expect(linkedStatusLines({ source: "plaid", syncedAt: null, issue: null }, fmt)).toEqual([
      "Linked via Plaid",
      "Not synced yet",
    ]);
  });

  it("adds the broken-link line after the time", () => {
    expect(linkedStatusLines({ source: "plaid", syncedAt: "t", issue: "reconnect" }, fmt)).toEqual([
      "Linked via Plaid",
      "Last updated <t>",
      "Needs reconnecting",
    ]);
    expect(linkedStatusLines({ source: "plaid", syncedAt: null, issue: "revoked" }, fmt)).toEqual([
      "Linked via Plaid",
      "Not synced yet",
      "Access revoked",
    ]);
  });

  // The server cannot know the viewer's time zone, so it renders no time at
  // all rather than one in the server's zone.
  it("omits the time line when no formatter is given", () => {
    expect(linkedStatusLines({ source: "schwab", syncedAt: "t", issue: null })).toEqual(["Synced from Schwab"]);
  });
});
