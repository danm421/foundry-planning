import { describe, it, expect } from "vitest";
import { TARGET_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import { PROMOTE_TABLE_REGISTRY, NESTED_ONLY_KINDS } from "../promote-table-registry";

describe("PROMOTE_TABLE_REGISTRY", () => {
  it("registers a childUpdater for expense (dedicated-account rewrites on edit)", () => {
    expect(PROMOTE_TABLE_REGISTRY.expense?.childUpdater).toBeTypeOf("function");
  });

  it("covers every overlayable array kind", () => {
    for (const [kind, field] of Object.entries(TARGET_KIND_TO_FIELD)) {
      if (field === null) continue; // singletons + nested-only
      if (NESTED_ONLY_KINDS.has(kind as never)) continue;
      expect(
        PROMOTE_TABLE_REGISTRY[kind as keyof typeof PROMOTE_TABLE_REGISTRY],
      ).toBeDefined();
    }
  });
});
