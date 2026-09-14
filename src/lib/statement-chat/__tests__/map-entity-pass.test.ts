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

beforeEach(() => vi.clearAllMocks());

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
