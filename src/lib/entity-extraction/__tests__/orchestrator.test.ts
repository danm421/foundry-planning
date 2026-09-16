// src/lib/entity-extraction/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

// Wraps the REAL `documentEvidenceEntities` by default (every existing test
// below calls through to it unchanged) so a single test can drive two
// DIFFERENT real entity sets through the real prompt-hashing path via
// `mockReturnValueOnce`, without widening the module's public API to export
// `promptVersionFor` just for this one assertion.
vi.mock("@/domain/forge/detail-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/forge/detail-fields")>();
  return { ...actual, documentEvidenceEntities: vi.fn(actual.documentEvidenceEntities) };
});

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { DETAIL_ENTITIES, documentEvidenceEntities } from "@/domain/forge/detail-fields";
import { REDACTED_SSN_PLACEHOLDER } from "@/lib/extraction/redact-ssn";
import { extractMapEntities } from "../orchestrator";

const mocked = vi.mocked(callAIExtraction);
const mockedEntities = vi.mocked(documentEvidenceEntities);
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
    // Drive two DIFFERENT real entities through the real hash path (rather
    // than asserting only the `map:` prefix, which a hardcoded constant would
    // also satisfy). If `promptVersion` were pinned to a fixed string, this
    // would fail on the final `not.toBe` — that is the non-vacuity proof.
    const [lifeInsurance, disability] = DETAIL_ENTITIES.filter((e) => e.documentEvidence);

    mockedEntities.mockReturnValueOnce([lifeInsurance]);
    respond({ [lifeInsurance.id]: [] });
    const first = await extractMapEntities({ fileId: "f1", pages: PAGES });

    mockedEntities.mockReturnValueOnce([disability]);
    respond({ [disability.id]: [] });
    const second = await extractMapEntities({ fileId: "f1", pages: PAGES });

    expect(first.promptVersion).toMatch(/^map:/);
    expect(second.promptVersion).toMatch(/^map:/);
    expect(first.promptVersion).not.toBe(second.promptVersion);
  });

  it("skips a raw null field like an omitted key, so the rest of the row and the region still succeed", async () => {
    // The model is told to OMIT a key it cannot fill rather than guess, but a
    // reply can still hand back a bare `null` for one field (not the
    // `{value,...}` shape this type promises). That must cost one field, not
    // the whole row or region: `placeRow` skips it exactly like an omitted
    // key, so the row is still produced with `faceValue` recorded missing.
    respond(
      { life_insurance_policy: [[2, 2]] },
      { rows: [{
        name: { value: "Term Life", snippet: "Policy Summary", confidence: 0.9 },
        faceValue: null,
      }] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows.life_insurance_policy).toHaveLength(1);
    const row = result.rows.life_insurance_policy[0];
    expect(row.values.find((v) => v.key === "name")?.value).toBe("Term Life");
    expect(row.values.find((v) => v.key === "faceValue")).toBeUndefined();
    expect(row.missingRequired).toContain("faceValue");
    expect(result.warnings).toEqual([]);
  });

  it("keeps the other entity's rows when one entity's reply throws during placement, and warns", async () => {
    // A shape neither the AI-call try/catch nor the null-field skip already
    // covers: the model's own `rows` array contains a bare `null` "row"
    // rather than an object. `placeRow` deref's `raw[field.key]` on it and
    // throws synchronously mid-map, inside the SAME `Promise.all` both
    // entities' reads share. This pins the general contract widening the
    // `readRegion` try/catch exists for: the call itself succeeded, but
    // whatever failed downstream must still cost only its own entity.
    respond(
      { life_insurance_policy: [[2, 2]], disability_policy: [[3, 3]] },
      { rows: [null] },
      { rows: [{ carrier: { value: "Unum", snippet: "Carrier: Unum", confidence: 0.9 } }] },
    );
    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });
    expect(result.rows.disability_policy).toHaveLength(1);
    expect(result.rows.life_insurance_policy).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/life_insurance_policy/);
  });

  it("redacts an SSN-shaped value before either AI call, and reports the count", async () => {
    const pagesWithSsn = [...PAGES];
    pagesWithSsn[1] = pagesWithSsn[1] + "\nSSN: 123-45-6789";
    // Empty ranges: only the classifier call is made, so its arguments are
    // the only place a leak could show up.
    respond({ life_insurance_policy: [], disability_policy: [] });

    const result = await extractMapEntities({ fileId: "f1", pages: pagesWithSsn });

    expect(mocked).toHaveBeenCalledTimes(1);
    const classifierArgs = mocked.mock.calls[0].join(" ");
    expect(classifierArgs).not.toContain("123-45-6789");
    expect(classifierArgs).toContain(REDACTED_SSN_PLACEHOLDER);
    expect(result.warnings.join(" ")).toMatch(/redacted 1 ssn-like value/i);
  });

  /**
   * Final review, C3. The test above uses EMPTY ranges on purpose, so only the
   * classifier is ever called — it therefore asserts nothing about the
   * PER-REGION reads, which are two of the three call sites the redaction
   * constraint covers (the third, the grounding haystack, is the same string:
   * `readRegion` passes `regionText` as `documentText`).
   *
   * The surviving mutation this pins: change `sliceRegion(pages, …)` to
   * `sliceRegion(args.pages, …)` at `orchestrator.ts:142`. The implementation
   * is correct today — `pages` is the redacted rebinding — but before this test
   * every suite on the branch stayed green under that one-word change while
   * every per-region extraction shipped an un-redacted SSN to Azure.
   */
  it("redacts the SSN in the PER-REGION extraction call, not only the classifier's", async () => {
    const pagesWithSsn = [...PAGES];
    pagesWithSsn[1] = pagesWithSsn[1] + "\nSSN: 123-45-6789";
    // A NON-empty range covering the page the SSN is on, so call[1] IS the
    // region read of that page. An empty range here would test nothing.
    respond(
      { life_insurance_policy: [[2, 2]], disability_policy: [] },
      { rows: [{ name: { value: "Term Life", snippet: "Policy Summary", confidence: 0.9 } }] },
    );

    await extractMapEntities({ fileId: "f1", pages: pagesWithSsn });

    expect(mocked).toHaveBeenCalledTimes(2);
    const regionArgs = mocked.mock.calls[1].join(" ");
    // Both halves matter. `not.toContain` alone would pass if the region text
    // were empty; `toContain` alone would pass if BOTH the placeholder and the
    // raw value were sent.
    expect(regionArgs).not.toContain("123-45-6789");
    expect(regionArgs).toContain(REDACTED_SSN_PLACEHOLDER);
  });

  /**
   * "The classifier named a range" and "that range holds text" are different
   * facts. `sliceRegion` drops out-of-bounds pages, so an invented range
   * slices to "" — and reading it buys a full billable Azure call to be told
   * what the empty slice already said.
   *
   * Not hypothetical on the OCR path: `pages` there is one entry per rendered
   * BATCH (<=4 pages), while the scan's own text still prints "Page 41 of 53"
   * into the anchors, so a range stated against the printed page count runs
   * off the end of a 14-element array.
   */
  it("does not spend an extraction call on a region that slices to nothing", async () => {
    // Page 99 does not exist in a 3-page document.
    respond({ life_insurance_policy: [[99, 99]], disability_policy: [] });

    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });

    // ONLY the classifier ran. A second call here is the billable waste.
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual({});
    expect(result.warnings).toContainEqual(expect.stringContaining("no readable text"));
  });

  it("still reads the entities whose ranges DO hold text", async () => {
    // Positive control: without this, skipping every region would pass the
    // test above. One entity overshoots, the other is real — the real one
    // must still be read, and its call must be the only extraction.
    respond(
      { life_insurance_policy: [[99, 99]], disability_policy: [[3, 3]] },
      { rows: [{ carrier: { value: "Unum", snippet: "Carrier: Unum", confidence: 0.9 } }] },
    );

    const result = await extractMapEntities({ fileId: "f1", pages: PAGES });

    expect(mocked).toHaveBeenCalledTimes(2);
    expect(result.rows.disability_policy).toHaveLength(1);
    expect(result.rows.life_insurance_policy).toBeUndefined();
  });
});
