/**
 * Whether the estate views should model a SECOND (survivor's) death — i.e.
 * render the second-death column and enable the split death-year toggle.
 *
 * Keyed on spouse EXISTENCE (`client.spouseDob`), NOT filing status. The
 * projection engine schedules the final (survivor's) death off `client.spouseDob`
 * — see `computeTodayHypotheticalEstateTax` in `src/engine/projection.ts`, which
 * documents that filing status is the wrong signal. The estate UI must use the
 * SAME signal, or the two disagree:
 *
 *   A spouse'd household that files single/separately (e.g. MFS, or an as-yet
 *   unmarried couple) has `filingStatus !== "married_*"` but `spouseDob != null`.
 *   Gating the column on filing status then hides the second-death column even
 *   though the engine has already computed the survivor's death and its
 *   distribution to heirs — leaving a blank third column.
 */
export function hasSpouseForEstate(
  spouseDob: string | null | undefined,
): boolean {
  return spouseDob != null;
}
