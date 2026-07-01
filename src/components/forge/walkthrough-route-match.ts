/** Match a walkthrough nextPage pattern against a pathname. A ":name" segment
 *  is a single-segment wildcard (matches any non-empty segment). Segment counts
 *  must be equal — "/crm/households/:id" matches "/crm/households/abc" but not
 *  "/crm/households" or "/crm/households/a/b". */
export function matchesWalkthroughRoute(pattern: string, pathname: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("/").filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith(":") ? a[i].length > 0 : seg === a[i]));
}
