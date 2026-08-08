import * as fuzzball from "fuzzball";
import { listCrmHouseholds } from "@/lib/crm/households";
import type { ParsedRow } from "./rows";

const DEDUP_THRESHOLD = 75;
const MAX_MATCHES = 3;
const DEDUP_CORPUS_LIMIT = 1000;

export type DuplicateMatch = { id: string; name: string; score: number };
export type RowDuplicates = { rowIndex: number; matches: DuplicateMatch[] };

type ExistingForDedup = { id: string; name: string };

/**
 * Strip diacritics + lowercase so `García` ↔ `Garcia` and `Smith` ↔ `smith`
 * both score as exact matches, which token_set_ratio won't do on its own.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Fuzzy-match each row's household name against the firm's existing CRM
 * households. `opts.existingHouseholds` is a test seam; in production the
 * corpus is fetched, capped at DEDUP_CORPUS_LIMIT, and `partialDedupCorpus`
 * warns the advisor that matches beyond the cap may be missed.
 */
export async function findDuplicates(
  rows: readonly ParsedRow[],
  opts: { existingHouseholds?: ExistingForDedup[] } = {},
): Promise<{ duplicates: RowDuplicates[]; partialDedupCorpus: boolean }> {
  let existing: ExistingForDedup[];
  let partialDedupCorpus = false;
  if (opts.existingHouseholds) {
    existing = opts.existingHouseholds;
  } else {
    const live = await listCrmHouseholds({ limit: DEDUP_CORPUS_LIMIT });
    existing = live.map((h) => ({ id: h.id, name: h.name }));
    partialDedupCorpus = live.length === DEDUP_CORPUS_LIMIT;
  }

  const normExisting = existing.map((h) => ({ ...h, norm: normalize(h.name) }));
  const duplicates: RowDuplicates[] = [];

  for (const row of rows) {
    if (row.errors.length > 0) continue; // an unimportable row can't be a dupe
    const candidate = normalize(row.household.name);
    const matches: DuplicateMatch[] = [];
    for (const cand of normExisting) {
      const score = fuzzball.token_set_ratio(candidate, cand.norm);
      if (score >= DEDUP_THRESHOLD) {
        matches.push({ id: cand.id, name: cand.name, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    if (matches.length > 0) {
      duplicates.push({ rowIndex: row.rowIndex, matches: matches.slice(0, MAX_MATCHES) });
    }
  }

  return { duplicates, partialDedupCorpus };
}
