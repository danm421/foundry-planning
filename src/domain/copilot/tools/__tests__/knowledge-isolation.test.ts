/**
 * Behavioral tenant-isolation test for `searchPlanningKb` against a real DB with
 * the `planning_kb_chunks` table. Seeds a firm-A row, a firm-B row, and a global
 * (firm_id NULL) row, then drives the REAL tool and asserts a firm-A query
 * returns firm-A + global and NEVER the firm-B row — i.e. the canonical scope
 * WHERE `(firm_id IS NULL OR firm_id = :firmId)` actually isolates tenants.
 *
 * Guarded twice: skipped when DATABASE_URL is unset, and (via runtime ctx.skip)
 * when the table is absent — so it stays a clean no-op on the table-less dev
 * branch and only asserts when the migration has been applied. The client-doc
 * scoping half of the contract was additionally verified live on a Neon branch
 * during Phase-4 execution (firm-A/client-X excludes client-Y docs).
 *
 * Requires DATABASE_URL. embeddings() + assertClientReadable are mocked so the
 * test exercises the scope WHERE on real pgvector data, not similarity or auth.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Load .env.local before importing anything that reads DATABASE_URL at init.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {
  // .env.local absent — the DATABASE_URL guard below handles it.
}

// Exercise the scope WHERE on real data, not embeddings/auth: a fixed non-zero
// query vector (matching the seeded rows) keeps cosine distance well-defined.
const QUERY_VEC = Array(1536).fill(0.1);
vi.mock("../../llm", () => ({ embeddings: vi.fn().mockResolvedValue(QUERY_VEC) }));
vi.mock("../../guards", () => ({
  assertClientReadable: vi.fn().mockResolvedValue(undefined),
  ForbiddenScopeError: class extends Error {},
}));

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const FIRM_A = "kbiso_firm_a";
const FIRM_B = "kbiso_firm_b";
const PREFIX = "KBISO-";

d("searchPlanningKb tenant isolation", () => {
  let tableExists = false;
  let searchPlanningKb: typeof import("../knowledge").searchPlanningKb;
  let db: typeof import("@/db").db;
  let planningKbChunks: typeof import("@/db/schema").planningKbChunks;
  let like: typeof import("drizzle-orm").like;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    like = drizzle.like;
    db = (await import("@/db")).db;
    planningKbChunks = (await import("@/db/schema")).planningKbChunks;
    searchPlanningKb = (await import("../knowledge")).searchPlanningKb;

    const reg = await db.execute(drizzle.sql`SELECT to_regclass('public.planning_kb_chunks') AS t`);
    tableExists = !!(reg as unknown as { rows: Array<{ t: string | null }> }).rows[0]?.t;
    if (!tableExists) return;

    await db.delete(planningKbChunks).where(like(planningKbChunks.sourceRef, `${PREFIX}%`));
    const vec = Array(1536).fill(0.1);
    await db.insert(planningKbChunks).values([
      { source: "firm_note", sourceRef: `${PREFIX}A`, firmId: FIRM_A, clientId: null,
        chunkText: "firm A note", contentHash: "kbiso_hash_a", embedding: vec, metadata: {} },
      { source: "firm_note", sourceRef: `${PREFIX}B`, firmId: FIRM_B, clientId: null,
        chunkText: "firm B note", contentHash: "kbiso_hash_b", embedding: vec, metadata: {} },
      { source: "planning_playbook", sourceRef: `${PREFIX}G`, firmId: null, clientId: null,
        chunkText: "global note", contentHash: "kbiso_hash_g", embedding: vec, metadata: {} },
    ]);
  });

  afterAll(async () => {
    if (tableExists) await db.delete(planningKbChunks).where(like(planningKbChunks.sourceRef, `${PREFIX}%`));
  });

  it("returns firm-A + global rows and NEVER the firm-B row", async (ctx) => {
    if (!tableExists) { ctx.skip(); return; }
    // A syntactically valid uuid (no client-doc rows reference it, so the
    // client half of the scope WHERE — client_id IS NULL OR = :clientId — admits
    // every seeded firm/global row); the column is uuid, so a non-uuid is rejected.
    const ctxA = { userId: "u", firmId: FIRM_A, clientId: "00000000-0000-0000-0000-000000000000", scenarioId: "base" };
    const { chunks } = await searchPlanningKb("irmaa", 50, ctxA);
    const refs = chunks.map((c) => c.sourceRef).filter((r) => r.startsWith(PREFIX)).sort();
    expect(refs).toEqual([`${PREFIX}A`, `${PREFIX}G`]); // firm-A + global, NOT firm-B
    expect(refs).not.toContain(`${PREFIX}B`);
  });
});
