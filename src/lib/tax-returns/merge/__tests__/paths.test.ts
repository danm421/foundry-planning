import { describe, it, expect } from "vitest";
import {
  derivedEntityKey, entityKey, entityPath, isAdvisorKey, newAdvisorKey,
  ENTITY_DELETED_FIELD, parseEntityPath,
} from "../paths";

describe("entityKey", () => {
  it("prefers a stored entityId over every derived value", () => {
    // The whole point of storing identity: a renamed entity keeps its key.
    expect(entityKey({
      entityId: "12-3456789", ein: "98-7654321", entityName: "Renamed Co",
    })).toBe("12-3456789");
  });

  it("falls back to the derived key when there is no stored id", () => {
    expect(entityKey({ entityId: null, ein: "12-3456789" })).toBe("12-3456789");
    expect(entityKey({ entityId: "   ", entityName: "Ridge Partners LLC" }))
      .toBe("name:ridge partners llc");
  });

  it("derivedEntityKey ignores a stored id, so cross-document union still works", () => {
    // Two independent extractions can never agree on a minted id, but they do
    // agree on an EIN. `mergeEntities` needs the derived value to union them.
    expect(derivedEntityKey({ entityId: "adv:abc", ein: "12-3456789" })).toBe("12-3456789");
  });

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

  it("keys a business (no ein/entityName fields, just name) by normalized name", () => {
    expect(entityKey({ name: "Mueller Consulting" })).toBe("name:mueller consulting");
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

  it("round-trips the deletion pseudo-field", () => {
    // `__deleted` must survive the field regex, or a deletion override becomes
    // an unparseable scalar path and the entity resurrects.
    const path = entityPath("k1s", "12-3456789", ENTITY_DELETED_FIELD);
    expect(parseEntityPath(path)).toEqual({
      collection: "k1s", key: "12-3456789", field: "__deleted",
    });
  });

  it("round-trips an advisor key, whose colon must not be read as a field separator", () => {
    const key = newAdvisorKey();
    const path = entityPath("k1s", key, "entityName");
    expect(parseEntityPath(path)).toEqual({ collection: "k1s", key, field: "entityName" });
  });
});

describe("advisor keys", () => {
  it("mints a key no document can produce", () => {
    const key = newAdvisorKey();
    expect(isAdvisorKey(key)).toBe(true);
    // The safety property: `applyOverrides` may CREATE an entity only under an
    // advisor key, and no derived or fallback key can ever be one — so a stale
    // override can never resurrect a document-sourced entity.
    expect(isAdvisorKey("12-3456789")).toBe(false);
    expect(isAdvisorKey("name:ridge partners llc")).toBe(false);
    expect(isAdvisorKey("doc:abc-123:0")).toBe(false);
  });

  it("mints a distinct key each call", () => {
    expect(newAdvisorKey()).not.toBe(newAdvisorKey());
  });
});
