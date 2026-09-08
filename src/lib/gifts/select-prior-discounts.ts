/**
 * The prefill selection rule for valuation discounts — which of a source's past
 * gifts should seed the discount field on the next one.
 *
 * A discount is stored per gift, never on the account or the entity: block size
 * legitimately changes the discount, and a source-level value would silently
 * rewrite gifts already modeled or already filed on a Form 709. Prefill is the
 * UX mitigation — it is an INITIAL VALUE ONLY. The value stored on a gift is
 * always that gift's own, and editing the source gift never reaches back.
 *
 * The rule:
 *  - Later gift years win.
 *  - Among candidates sharing a year, the last one listed wins.
 *  - A candidate with no discount (`0`, or anything not `> 0`) is not a
 *    candidate at all. So a later undiscounted gift never clears an earlier
 *    discount — an advisor who left the field blank did not mean "the discount
 *    is gone" — and a source whose gifts are all undiscounted is simply absent
 *    from the map rather than prefilling a misleading "0%".
 *
 * Two advisor surfaces prefill from this — the estate-flow gift form
 * (`priorDiscountsBySource`) and the trust dialog's asset-transfer form — and
 * they must never disagree about a figure that may already be on a filed Form
 * 709. That is why the rule lives here rather than in either caller. Callers
 * differ only in how they turn their own rows into candidates: what the key
 * means, and where the year and the discount are read from.
 */

export interface PriorDiscountCandidate {
  /** Prefill key. An account id, or a caller-namespaced key such as
   *  `entity:<id>` where one map spans more than one kind of source. */
  key: string;
  /** Gift year — the tiebreak that decides which candidate is "most recent". */
  year: number;
  /** Discount as a FRACTION (0.3 = 30%). Map "no discount" to 0. */
  discount: number;
}

/** Most-recent usable valuation discount per key. See the module docstring for
 *  the rule and why it is shared. */
export function selectPriorDiscounts(
  candidates: Iterable<PriorDiscountCandidate>,
): Record<string, number> {
  const best = new Map<string, { year: number; discount: number }>();
  for (const c of candidates) {
    // Written as `!(x > 0)` so NaN is excluded too.
    if (!(c.discount > 0)) continue;
    const prev = best.get(c.key);
    // `>=` so that, among candidates sharing a year, the last listed wins.
    if (prev == null || c.year >= prev.year) {
      best.set(c.key, { year: c.year, discount: c.discount });
    }
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, v.discount]));
}
