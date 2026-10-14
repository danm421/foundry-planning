/**
 * Tax figures are bracket-grounded only when bracket mode is on AND tax-year
 * rows loaded. Otherwise the engine fell back to flat rates, and nothing
 * downstream should present its tax numbers as bracket-accurate.
 */
export function isTaxGrounded(tree: {
  planSettings?: { taxEngineMode?: string };
  taxYearRows?: unknown[];
}): boolean {
  return tree.planSettings?.taxEngineMode === "bracket" && (tree.taxYearRows?.length ?? 0) > 0;
}
