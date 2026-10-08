import { describe, it, expect } from "vitest";
import { TARGET_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import { ltcPolicies } from "@/db/schema";
import {
  PROMOTE_TABLE_REGISTRY,
  NESTED_ONLY_KINDS,
  SCENARIO_ONLY_KINDS,
} from "../promote-table-registry";

describe("PROMOTE_TABLE_REGISTRY", () => {
  it("registers a childUpdater for expense (dedicated-account rewrites on edit)", () => {
    expect(PROMOTE_TABLE_REGISTRY.expense?.childUpdater).toBeTypeOf("function");
  });

  // Every kind whose EDIT can move rows in a child table needs an updater as
  // well as a writer. `coerceForTable` filters an edit's `set` down to real
  // columns, so an array field with no updater vanishes and the UPDATE degrades
  // to a silent `updatedAt` no-op: promoting a trust dissolve would leave the
  // base will still paying to the trust the same promote deleted, and
  // `will_bequest_recipients.recipientId` carries no FK to clean the orphan up.
  it.each(["will", "liability", "expense", "savings_rule", "account", "reinvestment"] as const)(
    "registers a childUpdater for %s, which has a childWriter",
    (kind) => {
      expect(PROMOTE_TABLE_REGISTRY[kind]?.childWriter).toBeTypeOf("function");
      expect(PROMOTE_TABLE_REGISTRY[kind]?.childUpdater).toBeTypeOf("function");
    },
  );

  // A disability payload is engine-shaped (`shortTerm` / `longTerm` objects),
  // while the row is flat has*/std*/ltd* columns. Without a translator on BOTH
  // paths `coerceForTable` drops the objects: an add lands as DB defaults and an
  // edit degrades to an `updatedAt` no-op.
  it("translates disability_policy payloads on insert and on update", () => {
    expect(PROMOTE_TABLE_REGISTRY.disability_policy?.translate).toBeTypeOf("function");
    expect(PROMOTE_TABLE_REGISTRY.disability_policy?.translateSet).toBeTypeOf("function");
  });

  // One shape: the payload's keys ARE the columns, so `coerceForTable` keeps
  // every field and no translator may sit in between.
  it("registers ltc_policy on its table with no translator", () => {
    expect(PROMOTE_TABLE_REGISTRY.ltc_policy?.table).toBe(ltcPolicies);
    expect(PROMOTE_TABLE_REGISTRY.ltc_policy?.translate).toBeUndefined();
    expect(PROMOTE_TABLE_REGISTRY.ltc_policy?.translateSet).toBeUndefined();
  });

  it("covers every overlayable array kind", () => {
    for (const [kind, field] of Object.entries(TARGET_KIND_TO_FIELD)) {
      if (field === null) continue; // singletons + nested-only
      if (NESTED_ONLY_KINDS.has(kind as never)) continue;
      if (SCENARIO_ONLY_KINDS.has(kind as never)) continue;
      expect(
        PROMOTE_TABLE_REGISTRY[kind as keyof typeof PROMOTE_TABLE_REGISTRY],
      ).toBeDefined();
    }
  });
});
