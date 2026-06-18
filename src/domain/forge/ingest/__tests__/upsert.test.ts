import { describe, it, expect, vi, beforeEach } from "vitest";

const onConflictDoNothing = vi.fn().mockReturnThis();
const values = vi.fn(() => ({ onConflictDoNothing, returning: () => Promise.resolve([{ id: "k1" }]) }));
const insert = vi.fn(() => ({ values }));
vi.mock("@/db", () => ({ db: { insert } }));
vi.mock("@/db/schema", () => ({ planningKbChunks: { contentHash: "content_hash_col" } }));

beforeEach(() => { insert.mockClear(); values.mockClear(); onConflictDoNothing.mockClear(); });

describe("upsertChunk", () => {
  it("inserts with onConflictDoNothing keyed on content_hash (idempotent ingest)", async () => {
    const { upsertChunk } = await import("../upsert");
    await upsertChunk({
      source: "planning_playbook", sourceRef: "Playbook §IRMAA",
      firmId: null, clientId: null, chunkText: "irmaa is...",
      contentHash: "deadbeef", embedding: Array(1536).fill(0.1), metadata: {},
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});
