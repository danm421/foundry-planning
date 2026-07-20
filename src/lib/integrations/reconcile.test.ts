// src/lib/integrations/reconcile.test.ts
import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const acct = (externalId: string, name: string) => ({ externalId, externalProvider: "orion", name } as any);

describe("reconcile", () => {
  it("classifies by external id", () => {
    const out = reconcile({
      mapped: [acct("a1", "Joint"), acct("a2", "Roth")],
      existing: [{ id: "uuid-1", externalId: "a1" }],
    });
    expect(out.exact).toEqual([{ account: expect.objectContaining({ externalId: "a1" }), existingId: "uuid-1" }]);
    expect(out.new.map((a) => a.externalId)).toEqual(["a2"]);
  });

  it("treats accounts with no external id match as new", () => {
    const out = reconcile({ mapped: [acct("a9", "x")], existing: [] });
    expect(out.new).toHaveLength(1);
    expect(out.exact).toHaveLength(0);
  });
});
