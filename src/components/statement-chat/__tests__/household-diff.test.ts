import { describe, it, expect } from "vitest";
import { buildHouseholdDiff, buildHouseholdCommitRow } from "../household-diff";
import { findEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";

const entity = findEntity("client_household")!;

const extracted = {
  entityId: "client_household",
  rowId: "f:client_household:0",
  missingRequired: [],
  rowConfidence: 0.9,
  values: [
    { key: "firstName", value: "Jonathan", snippet: "Jonathan A. Smith", confidence: 0.95 },
    { key: "lastName", value: "Smith", snippet: "Jonathan A. Smith", confidence: 0.95 },
    { key: "dateOfBirth", value: "1968-03-14", snippet: "DOB 3/14/1968", confidence: 0.9 },
    { key: "mobile", value: "(215) 555-0147", snippet: "Mobile (215) 555-0147", confidence: 0.9 },
  ],
} as unknown as CandidateRow;

const onRecord = { firstName: "John", lastName: "Smith", dateOfBirth: "1968-03-04", mobile: null };

/** One `values` array, the same envelope — for the cases that need other keys. */
function rowOf(values: { key: string; value: unknown }[]): CandidateRow {
  return {
    ...extracted,
    values: values.map((v) => ({ ...v, snippet: `${v.key} ${String(v.value)}`, confidence: 0.9 })),
  } as unknown as CandidateRow;
}

/**
 * The document the entity's own `documentHints` describe: contact details for
 * the client AND the spouse, which is where `client_household`'s duplicate
 * labels collide. `address` / `spouseAddress` are the legacy single-line keys,
 * which carry the SAME label as `addressLine1` / `spouseAddressLine1`.
 */
const contacts = rowOf([
  { key: "email", value: "jon@example.com" },
  { key: "spouseEmail", value: "mary@example.com" },
  { key: "addressLine1", value: "12 Oak St" },
  { key: "address", value: "12 Oak Street" },
  { key: "spouseAddressLine1", value: "9 Elm St" },
  { key: "spouseAddress", value: "9 Elm Street" },
]);

describe("buildHouseholdDiff", () => {
  it("omits a field the document agrees with", () => {
    expect(buildHouseholdDiff({ entity, extracted, onRecord }).map((r) => r.key)).not.toContain("lastName");
  });

  it("includes a field that disagrees", () => {
    const row = buildHouseholdDiff({ entity, extracted, onRecord }).find((r) => r.key === "firstName");
    expect(row).toMatchObject({ onRecord: "John", found: "Jonathan" });
  });

  it("includes a field that is blank on record", () => {
    expect(buildHouseholdDiff({ entity, extracted, onRecord }).map((r) => r.key)).toContain("mobile");
  });

  it("flags the four fields that move the plan horizon", () => {
    const dob = buildHouseholdDiff({ entity, extracted, onRecord }).find((r) => r.key === "dateOfBirth");
    expect(dob?.movesPlanHorizon).toBe(true);
    const mobile = buildHouseholdDiff({ entity, extracted, onRecord }).find((r) => r.key === "mobile");
    expect(mobile?.movesPlanHorizon).toBe(false);
  });

  it("omits a field that differs from the record only by case and surrounding space", () => {
    const rows = buildHouseholdDiff({ entity, extracted, onRecord: { ...onRecord, firstName: " jonathan " } });
    expect(rows.map((r) => r.key)).not.toContain("firstName");
  });

  it("omits a numeric on-record value the document states as a string", () => {
    const found = rowOf([{ key: "lifeExpectancy", value: "92" }]);
    expect(buildHouseholdDiff({ entity, extracted: found, onRecord: { lifeExpectancy: 92 } })).toEqual([]);
  });

  it("says whose Email is whose", () => {
    const rows = buildHouseholdDiff({ entity, extracted: contacts, onRecord: {} });
    expect(rows.find((r) => r.key === "email")?.label).toBe("Email");
    expect(rows.find((r) => r.key === "spouseEmail")?.label).toBe("Co-client Email");
  });

  it("does not qualify twice when the label already names the co-client", () => {
    const rows = buildHouseholdDiff({ entity, extracted: rowOf([{ key: "spouseDob", value: "1970-02-02" }]), onRecord: {} });
    expect(rows[0].label).toBe("Co-client Date of Birth");
  });

  /**
   * T7-(11). The dedupe fallback used to append the raw payload key, so the
   * advisor read "Address line 1 (spouseAddressLine1)" — a developer token in
   * advisor-facing copy. The collision is still real after the rename, so the
   * fallback still has to fire; it just has to fire in English.
   */
  it("names a colliding row from its key in words, never as a raw key", () => {
    const rows = buildHouseholdDiff({ entity, extracted: contacts, onRecord: {} });
    const collided = rows.filter((r) => r.key.toLowerCase().includes("address"));
    expect(collided.map((r) => r.label)).toEqual([
      "Address line 1",
      "Address",
      "Co-client Address line 1",
      "Co-client Address",
    ]);
    // The shape of the old fallback, in any row: a bracketed camelCase token.
    for (const row of rows) expect(row.label).not.toMatch(/\([a-z]+[A-Z]/);
  });

  it("gives every emitted row a label of its own", () => {
    const rows = buildHouseholdDiff({ entity, extracted: contacts, onRecord: {} });
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
  });

  /**
   * Both whole-table guarantees at full width — EVERY writable field of the
   * real `client_household` map at once, not the six-field fixture above.
   *
   * Uniqueness holds only because no two keys reduce to the same words, which
   * is a property of the MAP and a future field could break it.
   *
   * And the vocabulary is a property of the map too: the qualifier flipped to
   * "Co-client", so a map label still reading "Spouse Date of Birth" would
   * render "Co-client Email" next to it in one table — the half-renamed state
   * the controller ruled worse than either extreme. The repo's own gate cannot
   * catch that regression, because `profile.ts` stays red from its
   * machine-facing `documentHints` and `notes` either way.
   */
  it("gives every writable field of the real map a unique label an advisor can read", () => {
    const writable = entity.fields.filter((f) => f.writable !== false);
    const rows = buildHouseholdDiff({
      entity,
      extracted: rowOf(writable.map((f) => ({ key: f.key, value: `v-${f.key}` }))),
      onRecord: {},
    });
    expect(rows).toHaveLength(writable.length);
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
    for (const row of rows) expect(row.label.toLowerCase()).not.toContain("spouse");
  });

  it("never offers a field the writer would drop from the update body", () => {
    const found = rowOf([{ key: "planEndAge", value: "95" }]);
    expect(buildHouseholdDiff({ entity, extracted: found, onRecord: { planEndAge: 92 } })).toEqual([]);
  });
});

describe("buildHouseholdCommitRow", () => {
  it("carries only the accepted fields", () => {
    const row = buildHouseholdCommitRow({ clientId: "c1", extracted, acceptedKeys: ["firstName"] });
    expect(row.values.map((v) => v.key)).toEqual(["firstName"]);
  });

  it("marks the row as an exact match on the client so the writer updates", () => {
    const row = buildHouseholdCommitRow({ clientId: "c1", extracted, acceptedKeys: ["firstName"] });
    expect(row.match).toEqual({ kind: "exact", existingId: "c1" });
  });

  it("produces a PUT to the household route through the real writer", async () => {
    const { buildWriteRequest } = await import("@/lib/entity-writer");
    const row = buildHouseholdCommitRow({ clientId: "c1", extracted, acceptedKeys: ["firstName", "dateOfBirth"] });
    expect(buildWriteRequest({ entity, row })).toMatchObject({
      ok: true,
      method: "PUT",
      path: "/",
      body: { firstName: "Jonathan", dateOfBirth: "1968-03-14" },
    });
  });
});
