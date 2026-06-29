import { describe, it, expect } from "vitest";
import { inEstateWeight, outOfEstateWeight } from "@/lib/estate/in-estate-weights";
import type { ClientData } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";

const emptyTree = { entities: [] } as unknown as ClientData;

describe("gifted_away owner weighting", () => {
  const owner: AccountOwner = {
    kind: "gifted_away",
    recipient: { kind: "family_member", id: "fm-1" },
    percent: 0.1,
  };

  it("counts no value into the gross estate", () => {
    expect(inEstateWeight(emptyTree, owner)).toBe(0);
  });

  it("counts no value as out-of-estate either", () => {
    expect(outOfEstateWeight(emptyTree, owner)).toBe(0);
  });
});
