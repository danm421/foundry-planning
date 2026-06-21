import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import type { ValidatedOwner } from "@/lib/ownership";

vi.mock("@/db/schema", () => ({ entities: { _name: "entities" } }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a, and: (...a: unknown[]) => a }));

// Each `.limit()` shifts the next pre-seeded result, so tests control what the
// entity lookup returns in owner-array order.
let resultQueue: Array<Array<{ entityType: string }>> = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(resultQueue.shift() ?? []),
        }),
      }),
    }),
  },
}));

import { validateTrustOnlyEntityOwners } from "@/lib/portal/validate-trust-owners";

const entity = (id: string): ValidatedOwner => ({ kind: "entity", entityId: id, percent: 1 });
const fm = (id: string): ValidatedOwner => ({ kind: "family_member", familyMemberId: id, percent: 1 });

beforeEach(() => {
  resultQueue = [];
});

describe("validateTrustOnlyEntityOwners", () => {
  it("passes when the only entity owner is a trust", async () => {
    resultQueue = [[{ entityType: "trust" }]];
    expect(await validateTrustOnlyEntityOwners([entity("e1")], "c1")).toBeNull();
  });

  it("rejects when an entity owner is a non-trust (LLC)", async () => {
    resultQueue = [[{ entityType: "llc" }]];
    const res = await validateTrustOnlyEntityOwners([entity("e1")], "c1");
    expect(res).not.toBeNull();
    expect(res!.error).toMatch(/trust/i);
  });

  it("rejects when the entity row is missing", async () => {
    resultQueue = [[]];
    const res = await validateTrustOnlyEntityOwners([entity("ghost")], "c1");
    expect(res).not.toBeNull();
  });

  it("skips family-member owners without querying", async () => {
    // No queue entries — if the helper queried, it would still return [] and
    // (wrongly) reject. A null result proves family members are skipped.
    expect(await validateTrustOnlyEntityOwners([fm("fm1")], "c1")).toBeNull();
  });

  it("passes a mix of a family member and a trust entity", async () => {
    resultQueue = [[{ entityType: "trust" }]];
    expect(await validateTrustOnlyEntityOwners([fm("fm1"), entity("e1")], "c1")).toBeNull();
  });

  it("rejects on the first non-trust among multiple entity owners", async () => {
    resultQueue = [[{ entityType: "trust" }], [{ entityType: "llc" }]];
    const res = await validateTrustOnlyEntityOwners([entity("e1"), entity("e2")], "c1");
    expect(res).not.toBeNull();
  });
});
