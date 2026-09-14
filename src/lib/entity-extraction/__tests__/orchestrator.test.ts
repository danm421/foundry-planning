// src/lib/entity-extraction/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { extractMapEntities } from "../orchestrator";

const mocked = vi.mocked(callAIExtraction);
const PAGES = [
  "Cover page",
  "Policy Summary\nFace Amount $500,000\nPolicy Type: Term\nInsured: Michael\nOwner: Michael",
  "Disability\nCarrier: Unum\nMonthly Benefit Percent 60%\nElimination Period 90",
];

beforeEach(() => vi.clearAllMocks());

/** First call is the classifier; the rest are per-region extractions. */
function respond(classifier: unknown, ...regions: unknown[]) {
  mocked.mockResolvedValueOnce(JSON.stringify(classifier));
  for (const region of regions) mocked.mockResolvedValueOnce(JSON.stringify(region));
}

describe("extractMapEntities", () => {
  it("returns rows for each entity the classifier found", async () => {
    respond(
      { life_insurance_policy: [[2, 2]], disability_policy: [] },
      { rows: [{
        name: { value: "Term Life", snippet: "Policy Summary", confidence: 0.9 },
        faceValue: { value: "$500,000", snippet: "Face Amount $500,000", confidence: 0.95 },
        policyType: { value: "term", snippet: "Policy Type: Term", confidence: 0.9 },
        insuredPerson: { value: "client", snippet: "Insured: Michael", confidence: 0.9 },
        ownerRef: { value: "client", snippet: "Owner: Michael", confidence: 0.9 },
      }] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows.life_insurance_policy).toHaveLength(1);
    expect(result.rows.life_insurance_policy[0].values.find((v) => v.key === "faceValue")!.value).toBe(500000);
  });

  it("reads both entities when one document carries both", async () => {
    respond(
      { life_insurance_policy: [[2, 2]], disability_policy: [[3, 3]] },
      { rows: [{ name: { value: "Term Life", snippet: "Policy Summary", confidence: 0.9 } }] },
      { rows: [{ carrier: { value: "Unum", snippet: "Carrier: Unum", confidence: 0.9 } }] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows.life_insurance_policy).toHaveLength(1);
    expect(result.rows.disability_policy).toHaveLength(1);
  });

  it("does not call an extractor for an entity with no pages", async () => {
    respond({ life_insurance_policy: [], disability_policy: [] });
    await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("keeps the other regions when one region's call throws", async () => {
    mocked.mockResolvedValueOnce(JSON.stringify({ life_insurance_policy: [[2, 2]], disability_policy: [[3, 3]] }));
    mocked.mockRejectedValueOnce(new Error("azure down"));
    mocked.mockResolvedValueOnce(JSON.stringify({ rows: [{ carrier: { value: "Unum", snippet: "Carrier: Unum", confidence: 0.9 } }] }));
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows.disability_policy).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/life_insurance_policy/);
  });

  it("returns empty rows and a warning when classification fails", async () => {
    mocked.mockResolvedValueOnce("not json at all");
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows).toEqual({});
    expect(result.warnings.join(" ")).toMatch(/classif/i);
  });

  it("grounds against the pages the region covered, so an invented value is flagged", async () => {
    respond(
      { life_insurance_policy: [[2, 2]] },
      { rows: [{ faceValue: { value: "$750,000", snippet: "Face Amount $750,000", confidence: 0.99 } }] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    const face = result.rows.life_insurance_policy[0].values.find((v) => v.key === "faceValue")!;
    expect(face.issue).toBe("ungrounded");
  });

  it("gives every row a distinct id", async () => {
    respond(
      { life_insurance_policy: [[2, 2]] },
      { rows: [
        { name: { value: "A", snippet: "Policy Summary", confidence: 0.9 } },
        { name: { value: "B", snippet: "Policy Summary", confidence: 0.9 } },
      ] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    const ids = result.rows.life_insurance_policy.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(2);
  });

  it("changes promptVersion when the map changes", async () => {
    respond({ life_insurance_policy: [] });
    const first = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(first.promptVersion).toMatch(/^map:/);
  });
});
