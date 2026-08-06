import { describe, it, expect } from "vitest";
import { entityKey, entityPath, parseEntityPath } from "../paths";

describe("entityKey", () => {
  it("prefers EIN over name", () => {
    expect(entityKey({ ein: "12-3456789", entityName: "Ridge Partners LLC" })).toBe("12-3456789");
  });

  it("normalizes a name when there is no EIN", () => {
    expect(entityKey({ ein: null, entityName: "  Ridge Partners, LLC " })).toBe("name:ridge partners llc");
  });

  it("treats punctuation and case differences as the same entity", () => {
    expect(entityKey({ ein: null, entityName: "Ridge Partners LLC" }))
      .toBe(entityKey({ ein: null, entityName: "RIDGE PARTNERS, L.L.C." }));
  });

  it("returns null when there is nothing to key on", () => {
    expect(entityKey({ ein: null, entityName: null })).toBeNull();
    expect(entityKey({ ein: null, entityName: "   " })).toBeNull();
  });
});

describe("entityPath / parseEntityPath", () => {
  it("round-trips", () => {
    const path = entityPath("k1s", "12-3456789", "w2WagesFromEntity");
    expect(path).toBe("k1s[12-3456789].w2WagesFromEntity");
    expect(parseEntityPath(path)).toEqual({
      collection: "k1s", key: "12-3456789", field: "w2WagesFromEntity",
    });
  });

  it("round-trips a name-derived key containing spaces", () => {
    const path = entityPath("businesses", "name:mueller consulting", "netProfit");
    expect(parseEntityPath(path)).toEqual({
      collection: "businesses", key: "name:mueller consulting", field: "netProfit",
    });
  });

  it("returns null for a plain scalar path", () => {
    expect(parseEntityPath("income.wages")).toBeNull();
  });
});
