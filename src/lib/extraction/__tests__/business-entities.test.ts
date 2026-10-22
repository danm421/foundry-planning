import { describe, expect, it } from "vitest";
import { foldBusinessEntities } from "../business-entities";
import type { ExtractedAccount, ExtractedEntity } from "../types";

const hoboken: ExtractedAccount = {
  name: "Hoboken Improvement Co, LP, and Affiliates",
  category: "business",
  subType: "partnership",
  value: 1418000,
};

describe("foldBusinessEntities", () => {
  it("drops an entity reading of a business the document lists as an account — by its name, or that name cut short", () => {
    const entities: ExtractedEntity[] = [
      { name: "Hoboken Improvement Co, LP, and Affiliates", entityType: "partnership" },
      { name: "Hoboken Improvement Co, LP", entityType: "partnership" },
    ];
    expect(foldBusinessEntities({ accounts: [hoboken], entities })).toEqual({ accounts: [hoboken], entities: [] });
  });

  it("gives the account the entity's legal form when the account's own is missing or Other", () => {
    for (const subType of [undefined, "other"] as const) {
      const { accounts } = foldBusinessEntities({
        accounts: [{ ...hoboken, subType }],
        entities: [{ name: "Hoboken Improvement Co, LP", entityType: "partnership" }],
      });
      expect(accounts[0].subType).toBe("partnership");
    }
  });

  it("keeps a trust, a foundation, an unrelated business, and every entity when no account is a business", () => {
    const entities: ExtractedEntity[] = [
      { name: "Hoboken Improvement Co Trust", entityType: "trust" },
      { name: "Hoboken Improvement Co, LP", entityType: "foundation" },
      { name: "Acme Holdings LLC", entityType: "llc" },
    ];
    expect(foldBusinessEntities({ accounts: [hoboken], entities }).entities).toEqual(entities);

    const house: ExtractedAccount = { name: "Hoboken Improvement Co, LP", category: "real_estate", value: 1 };
    const partnership: ExtractedEntity = { name: "Hoboken Improvement Co, LP", entityType: "partnership" };
    expect(foldBusinessEntities({ accounts: [house], entities: [partnership] }).entities).toEqual([partnership]);
  });
});
