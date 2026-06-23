import { resolveRuleCategory, type RuleLike } from "./rule-matching";
import { mapPfcToSlug } from "./pfc-mapping";

export type ResolveInput = {
  rules: RuleLike[];
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  merchantName: string | null;
  name: string;
  slugToId: Map<string, string>;
};

export function resolveTransactionCategory(
  input: ResolveInput,
): { categoryId: string | null; categorizedBy: "rule" | "plaid" } {
  const ruleHit = resolveRuleCategory(input.rules, {
    merchantName: input.merchantName,
    name: input.name,
  });
  if (ruleHit) return { categoryId: ruleHit.categoryId, categorizedBy: "rule" };

  const slug = mapPfcToSlug(input.pfcPrimary, input.pfcDetailed);
  const pfcId = slug ? input.slugToId.get(slug) ?? null : null;
  return { categoryId: pfcId, categorizedBy: "plaid" };
}
