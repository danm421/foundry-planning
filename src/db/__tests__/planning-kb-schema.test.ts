import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { planningKbChunks, kbSourceEnum } from "../schema";

describe("planning_kb_chunks schema", () => {
  it("declares the expected columns", () => {
    const cols = getTableConfig(planningKbChunks).columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id", "source", "source_ref", "firm_id", "client_id",
        "chunk_text", "content_hash", "embedding", "metadata", "created_at",
      ]),
    );
  });
  it("uses the kb_source enum values from the spec", () => {
    expect(kbSourceEnum.enumValues).toEqual([
      "planning_playbook", "tax_reference", "client_document", "firm_note", "other",
    ]);
  });
});
