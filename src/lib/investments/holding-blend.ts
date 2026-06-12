// src/lib/investments/holding-blend.ts
//
// Pure helpers for the holding asset-class panel: resolving the security's
// "pulled" blend to firm asset-class ids, comparing blends (to decide whether a
// customization differs from what was pulled), and percent <-> fraction text.
// Kept framework-free so the panel's logic is unit-testable without a DOM.

/** A holding's asset-class blend as assetClassId → fractional weight (0–1). */
export type BlendMap = Map<string, number>;

interface SlugWeight {
  slug: string;
  weight: number;
}
interface IdWeight {
  assetClassId: string;
  weight: number;
}
interface ClassRef {
  id: string;
  slug: string | null;
}

/** Map a security's canonical-slug blend to firm asset-class ids. Slugs with no
 *  matching class are dropped — the same residual the rollup routes to inflation
 *  — so the result may sum to under 1. */
export function pulledBlend(
  securityWeights: readonly SlugWeight[],
  assetClasses: readonly ClassRef[],
): BlendMap {
  const bySlug = new Map<string, string>();
  for (const c of assetClasses) if (c.slug) bySlug.set(c.slug, c.id);
  const m: BlendMap = new Map();
  for (const w of securityWeights) {
    const id = bySlug.get(w.slug);
    if (id && w.weight > 0) m.set(id, (m.get(id) ?? 0) + w.weight);
  }
  return m;
}

/** Collapse id→weight entries into a blend map, keeping positive weights only. */
export function blendFromEntries(entries: readonly IdWeight[]): BlendMap {
  const m: BlendMap = new Map();
  for (const e of entries) {
    if (e.weight > 0) m.set(e.assetClassId, (m.get(e.assetClassId) ?? 0) + e.weight);
  }
  return m;
}

/** Two blends are equal when they cover the same classes within `eps`. Used to
 *  tell "still matches the pulled blend" from a real customization. */
export function blendsEqual(a: BlendMap, b: BlendMap, eps = 1e-4): boolean {
  if (a.size !== b.size) return false;
  for (const [id, w] of a) {
    const bw = b.get(id);
    if (bw == null || Math.abs(bw - w) > eps) return false;
  }
  return true;
}

/** Fraction (0–1) → percent text, trailing zeros dropped (0.11 → "11", 0.115 → "11.5"). */
export function formatPercent(frac: number): string {
  return String(parseFloat((frac * 100).toFixed(4)));
}

/** Percent text → fraction (0–1). Blank or unparseable → 0. */
export function parsePercent(raw: string | undefined): number {
  if (!raw) return 0;
  const v = parseFloat(raw) / 100;
  return isNaN(v) ? 0 : v;
}
