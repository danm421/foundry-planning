export type RuleLike = {
  matchType: "exact" | "contains";
  pattern: string;
  categoryId: string;
  priority: number;
};
export type TxnText = { merchantName: string | null; name: string };

export function matchesRule(rule: RuleLike, txn: TxnText): boolean {
  const pat = rule.pattern.trim().toLowerCase();
  if (!pat) return false;
  const fields = [txn.merchantName, txn.name];
  for (const f of fields) {
    if (f == null) continue;
    const v = f.toLowerCase();
    if (rule.matchType === "exact" ? v === pat : v.includes(pat)) return true;
  }
  return false;
}

export function resolveRuleCategory(
  rules: RuleLike[],
  txn: TxnText,
): { categoryId: string } | null {
  // Lowest priority wins; stable for equal priorities (array order preserved).
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) if (matchesRule(r, txn)) return { categoryId: r.categoryId };
  return null;
}
