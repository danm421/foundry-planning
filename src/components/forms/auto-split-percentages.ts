/**
 * Even-split + redistribute helpers for "list of people with percentages"
 * editors (beneficiary designations, bequest recipients, trust distribution
 * policy). Used by both `BeneficiaryRowList` (trust + designations) and
 * `BequestRecipientList` (wills) so the auto-default-100% / split-evenly UX
 * (`Foundry Planning Fixes #10`) stays consistent.
 *
 * The model: one or more rows can be marked as "manually edited". Their
 * percentages are pinned. Remaining rows split (100 − sum-of-pinned) evenly,
 * with rounding remainder going to the last unlocked row so the total is
 * exactly 100.00%.
 */

/** Distribute 100% across `count` slots, all 0.01-rounded except the last
 *  which absorbs the rounding remainder. */
export function splitEvenly(count: number): number[] {
  if (count <= 0) return [];
  const each = Math.floor((100 / count) * 100) / 100;
  const out = Array(count).fill(each);
  const remainder = Math.round((100 - each * count) * 100) / 100;
  out[count - 1] = Math.round((each + remainder) * 100) / 100;
  return out;
}

/** Walk `rows` and overwrite the percentage on every row whose key is NOT in
 *  `lockedKeys`, distributing (100 − sum-of-locked) evenly across them. The
 *  last unlocked row absorbs the rounding remainder. Locked rows are returned
 *  untouched. */
export function redistribute<T>(
  rows: T[],
  lockedKeys: ReadonlySet<string>,
  getKey: (r: T) => string,
  setPercentage: (r: T, percentage: number) => T,
): T[] {
  const lockedSum = rows
    .filter((r) => lockedKeys.has(getKey(r)))
    .reduce((s, r) => s + getCurrentPct(r as { percentage?: number }), 0);
  const remaining = Math.max(0, 100 - lockedSum);
  const unlockedIdx: number[] = [];
  rows.forEach((r, i) => {
    if (!lockedKeys.has(getKey(r))) unlockedIdx.push(i);
  });
  if (unlockedIdx.length === 0) return rows;

  const each = Math.floor((remaining / unlockedIdx.length) * 100) / 100;
  const used = each * unlockedIdx.length;
  const rem = Math.round((remaining - used) * 100) / 100;

  return rows.map((r, i) => {
    if (lockedKeys.has(getKey(r))) return r;
    const pos = unlockedIdx.indexOf(i);
    const isLast = pos === unlockedIdx.length - 1;
    const pct = Math.round((each + (isLast ? rem : 0)) * 100) / 100;
    return setPercentage(r, pct);
  });
}

function getCurrentPct(r: { percentage?: number }): number {
  const p = r.percentage;
  return typeof p === "number" && Number.isFinite(p) ? p : 0;
}

/** Run `redistribute` over a single tier's rows inside a list that mixes tiers
 *  (e.g. primary + contingent beneficiary designations). Rows in other tiers
 *  are returned untouched, since each tier sums to 100% independently. */
export function redistributeTier<T, Tier>(
  rows: T[],
  tier: Tier,
  lockedKeys: ReadonlySet<string>,
  getKey: (r: T) => string,
  getTier: (r: T) => Tier,
  setPercentage: (r: T, percentage: number) => T,
): T[] {
  const balanced = redistribute(
    rows.filter((r) => getTier(r) === tier),
    lockedKeys,
    getKey,
    setPercentage,
  );
  const byKey = new Map(balanced.map((r) => [getKey(r), r]));
  return rows.map((r) => byKey.get(getKey(r)) ?? r);
}
