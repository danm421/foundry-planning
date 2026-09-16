import { describe, it, expect } from "vitest";
import { splitRegions, PEOPLE_ENTITY_IDS } from "@/lib/entity-extraction/people-pass";

describe("splitRegions", () => {
  const regions = {
    client_household: [[1, 2] as [number, number]],
    family_member: [[2, 3] as [number, number]],
    related_party: [],
    life_insurance_policy: [[7, 9] as [number, number]],
    disability_policy: [],
  };

  it("routes the people entities to the people pass", () => {
    expect(Object.keys(splitRegions(regions).people).sort()).toEqual(
      ["client_household", "family_member", "related_party"],
    );
  });

  it("leaves every other entity to the map pass", () => {
    const { map } = splitRegions(regions);
    expect(Object.keys(map).sort()).toEqual(["disability_policy", "life_insurance_policy"]);
  });

  it("never lets one entity appear in both halves", () => {
    const { people, map } = splitRegions(regions);
    for (const id of Object.keys(people)) expect(map).not.toHaveProperty(id);
  });

  it("reports every claimed page once, sorted, so a later pass can take the complement", () => {
    expect(splitRegions(regions).claimedPages).toEqual([1, 2, 3, 7, 8, 9]);
  });

  it("claims no page for an entity with no ranges", () => {
    expect(splitRegions({ related_party: [] }).claimedPages).toEqual([]);
  });

  it("names exactly the three people entities", () => {
    expect([...PEOPLE_ENTITY_IDS].sort()).toEqual(["client_household", "family_member", "related_party"]);
  });
});
