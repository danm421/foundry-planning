/**
 * Ingest the curated global planning-KB seed into `planning_kb_chunks`.
 *
 * Parses data/planning-kb/seed.md (each `<!-- source: X | ref: Y -->` block is one
 * document), then chunks → hashes → embeds → idempotently upserts each as a global
 * row (firm_id = null, client_id = null). Re-running is a no-op for unchanged text
 * (the content_hash unique index makes the second pass insert zero new rows), which
 * is how this script proves idempotency end-to-end.
 *
 * Usage (against a throwaway Neon branch — NEVER author KB rows on prod from here):
 *   DATABASE_URL="postgres://…branch…" npx tsx scripts/ingest-planning-kb.ts
 *
 * Requires AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT (+ the other AZURE_* vars) in
 * .env.local; the embed call fails closed without them. A `*.local.ts` variant is
 * only needed to point at a live DB via an inline DATABASE_URL — never edit
 * .env.local to retarget.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Load .env.local without a runtime dep. Skips vars already set in the
// environment, so an inline DATABASE_URL=… wins over the .env.local value.
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {}

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ingestDocument } from "@/domain/forge/ingest";
import type { KbSource } from "@/domain/forge/tools/knowledge";

const SEED_PATH = resolve(process.cwd(), "data/planning-kb/seed.md");
const VALID_SOURCES: ReadonlySet<string> = new Set([
  "planning_playbook",
  "tax_reference",
  "client_document",
  "firm_note",
  "other",
]);

type SeedDoc = { source: KbSource; sourceRef: string; body: string };

/** Parse seed.md into one doc per `<!-- source: X | ref: Y -->` block. The body
 *  is everything from the block's heading line up to the next block (or EOF). */
function parseSeed(md: string): SeedDoc[] {
  const re = /<!--\s*source:\s*([a-z_]+)\s*\|\s*ref:\s*(.+?)\s*-->\s*\n##[^\n]*\n([\s\S]*?)(?=\n<!--\s*source:|\s*$)/g;
  const docs: SeedDoc[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const [, source, sourceRef, body] = m;
    if (!VALID_SOURCES.has(source)) {
      throw new Error(`Unknown source "${source}" for ref "${sourceRef}" — fix the seed.`);
    }
    docs.push({ source: source as KbSource, sourceRef: sourceRef.trim(), body: body.trim() });
  }
  return docs;
}

async function countRows(): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM planning_kb_chunks`);
  const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function main() {
  if (!process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT) {
    throw new Error("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT is not set — embed call fails closed.");
  }
  const docs = parseSeed(readFileSync(SEED_PATH, "utf8"));
  console.log(`[ingest] parsed ${docs.length} seed docs from ${SEED_PATH}`);

  const before = await countRows();
  let totalChunks = 0;
  for (const doc of docs) {
    const { chunks } = await ingestDocument({
      source: doc.source,
      sourceRef: doc.sourceRef,
      body: doc.body,
      firmId: null,
      clientId: null,
      metadata: { seed: true },
    });
    totalChunks += chunks;
    console.log(`[ingest] ${doc.source.padEnd(17)} ${doc.sourceRef} → ${chunks} chunk(s)`);
  }
  const after = await countRows();
  const inserted = after - before;
  console.log(
    `[ingest] done — ${totalChunks} chunk(s) embedded; rows ${before} → ${after} ` +
      `(${inserted} inserted, ${totalChunks - inserted} skipped as duplicates).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
