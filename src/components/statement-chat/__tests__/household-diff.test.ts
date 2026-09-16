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
