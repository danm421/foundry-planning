// src/lib/statement-chat/__tests__/map-entity-pass.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../entity-extraction", () => ({ extractMapEntities: vi.fn() }));
vi.mock("../existing-rows", () => ({ loadExistingRows: vi.fn() }));
vi.mock("@/db", () => ({ db: { query: {}, update: vi.fn() } }));

import { extractMapEntities } from "../../entity-extraction";
import { loadExistingRows } from "../existing-rows";
import { annotateMatches } from "../map-entity-pass";
import type { CandidateRow } from "@/lib/entity-extraction/types";

function row(entityId: string, values: Record<string, unknown>): CandidateRow {
  return {
    entityId,
    rowId: "r1",
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
  };
}

// RESET, not clear. `clearAllMocks` empties the call log but leaves a queued
// `mockResolvedValueOnce` that its own test never consumed — and the failure
// case below queues one for `life_insurance_policy`, which since M7 is never
// loaded. That leftover was served to the FIRST load of the next test, which
// then saw an empty existing set and reported `new` for a reason its assertion
// had nothing to do with. Found by a role-filter test that was green before the
// filter existed.
beforeEach(() => vi.resetAllMocks());

describe("annotateMatches", () => {
  it("marks a disability row that already exists as an update", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue([
      { id: "d1", values: { name: "Group LTD", insured: "client", carrier: "Unum" } },
    ]);
    const result = await annotateMatches({
      clientId: "c1",
      rows: { disability_policy: [row("disability_policy", { name: "Group LTD", insured: "client", carrier: "Unum" })] },
    });
    expect(result.disability_policy[0].match).toEqual({ kind: "exact", existingId: "d1" });
  });

  it("marks a row with no counterpart as new", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue([]);
    const result = await annotateMatches({
      clientId: "c1",
      rows: { disability_policy: [row("disability_policy", { name: "Brand New", insured: "client", carrier: "MetLife" })] },
    });
    expect(result.disability_policy[0].match).toEqual({ kind: "new" });
  });

  it("leaves life insurance as new — its matcher belongs to the wizard pass", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue([
      { id: "p1", values: { name: "Term Life 20" } },
    ]);
    const result = await annotateMatches({
      clientId: "c1",
      rows: { life_insurance_policy: [row("life_insurance_policy", { name: "Term Life 20" })] },
    });
    expect(result.life_insurance_policy[0].match).toEqual({ kind: "new" });
    // M7: and it must not have asked. `matchByIdentity` returns `new`
    // immediately for an entity with no `identity`, so this load's result was
    // always discarded — for `life_insurance_policy` that is an `accounts`
    // JOIN issued on every pass, for nothing.
    expect(loadExistingRows).not.toHaveBeenCalled();
  });

  it("does not load existing rows for an entity that produced none", async () => {
    await annotateMatches({ clientId: "c1", rows: { disability_policy: [] } });
    expect(loadExistingRows).not.toHaveBeenCalled();
    // Annotating is pure of the extractor: it reads rows it is handed and never
    // re-reads the document. (Also consumes the import this file declares.)
    expect(extractMapEntities).not.toHaveBeenCalled();
  });

  it("skips an unknown entity id rather than throwing", async () => {
    const result = await annotateMatches({
      clientId: "c1",
      rows: { not_a_real_entity: [row("not_a_real_entity", { a: 1 })] },
    });
    expect(result).not.toHaveProperty("not_a_real_entity");
  });

  it("keeps every other entity when one entity's load fails", async () => {
    vi.mocked(loadExistingRows)
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([]);
    const result = await annotateMatches({
      clientId: "c1",
      rows: {
        disability_policy: [row("disability_policy", { name: "A", insured: "client", carrier: "Unum" })],
        life_insurance_policy: [row("life_insurance_policy", { name: "B" })],
      },
    });
    expect(result.life_insurance_policy).toHaveLength(1);
    expect(result.disability_policy[0].match).toEqual({ kind: "new" });
  });
});

/**
 * The household's own people share a table with the people a document names.
 *
 * `family_members` holds the spouse (role "spouse") and the client (role
 * "client") next to the children; `crm_household_contacts` holds the
 * household's `primary` and `spouse` next to the external `other` contacts.
 * Both entities match on a NAME — `family_member` on a first name alone — so a
 * fact finder that lists the spouse, or names her as successor trustee,
 * exact-matched onto her own row and the update leg overwrote it.
 */
describe("annotateMatches — the household's own people are not match candidates", () => {
  // The three rows the household sync writes into `family_members`: the client,
  // the spouse, and a real child.
  const familyRows = [
    { id: "client-row", values: { firstName: "John", lastName: "Smith", role: "client" } },
    { id: "spouse-row", values: { firstName: "Jane", lastName: "Smith", role: "spouse" } },
    { id: "child-row", values: { firstName: "Emma", lastName: "Smith", role: "child" } },
  ];

  const contactRows = [
    { id: "primary-contact", values: { firstName: "John", lastName: "Smith", role: "primary" } },
    { id: "spouse-contact", values: { firstName: "Jane", lastName: "Smith", role: "spouse" } },
    { id: "cpa-contact", values: { firstName: "Grace", lastName: "Hopper", role: "other" } },
  ];

  it("offers a family member sharing the spouse's first name as new, not an update to the spouse", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue(familyRows);
    const result = await annotateMatches({
      clientId: "c1",
      rows: { family_member: [row("family_member", { firstName: "Jane", relationship: "child" })] },
    });
    // NOT `{ kind: "exact", existingId: "spouse-row" }`: that routed to the PUT,
    // which copies `relationship` — an enum with no spouse value — and turned
    // the spouse into a child with no refusal and no warning.
    expect(result.family_member[0].match).toEqual({ kind: "new" });
  });

  // NON-VACUITY. A filter that emptied the population would pass the test above
  // and duplicate every child the document names. The child must still match.
  it("still matches a family member onto an existing child", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue(familyRows);
    const result = await annotateMatches({
      clientId: "c1",
      rows: { family_member: [row("family_member", { firstName: "Emma", relationship: "child" })] },
    });
    expect(result.family_member[0].match).toEqual({ kind: "exact", existingId: "child-row" });
  });

  // A spouse is very often also the successor trustee, so "Successor trustee:
  // Jane Smith" lands on both of the two identity fields of her CRM row.
  it("offers a related party sharing the household spouse's name as new", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue(contactRows);
    const result = await annotateMatches({
      clientId: "c1",
      rows: {
        related_party: [
          row("related_party", { firstName: "Jane", lastName: "Smith", relationshipLabel: "Successor Trustee" }),
        ],
      },
    });
    expect(result.related_party[0].match).toEqual({ kind: "new" });
  });

  it("still matches a related party onto an existing 'other' contact", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue(contactRows);
    const result = await annotateMatches({
      clientId: "c1",
      rows: {
        related_party: [
          row("related_party", { firstName: "Grace", lastName: "Hopper", relationshipLabel: "CPA" }),
        ],
      },
    });
    expect(result.related_party[0].match).toEqual({ kind: "exact", existingId: "cpa-contact" });
  });

  // THE CONTROL. `disability_policies` has no `role` column, so its rows carry
  // no `role` key — a filter applied to every entity rather than only the two
  // people entities would drop them all and report this `new`.
  it("leaves an entity whose table has no role column matching exactly as before", async () => {
    vi.mocked(loadExistingRows).mockResolvedValue([
      { id: "d9", values: { name: "Group LTD", insured: "client", carrier: "Unum" } },
    ]);
    const result = await annotateMatches({
      clientId: "c1",
      rows: {
        disability_policy: [row("disability_policy", { name: "Group LTD", insured: "client", carrier: "Unum" })],
      },
    });
    expect(result.disability_policy[0].match).toEqual({ kind: "exact", existingId: "d9" });
  });
});
