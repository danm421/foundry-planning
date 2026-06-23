import { resolveRuleCategory, type RuleLike } from "./rule-matching";
import { resolveRecurringClaim, type RecurringLike } from "./recurring-matching";
import { mapPfcToSlug } from "./pfc-mapping";

export type ResolveInput = {
  rules: RuleLike[];
  recurrings: RecurringLike[];
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  merchantName: string | null;
  name: string;
  amount: number;
  date: string;
  slugToId: Map<string, string>;
};

export function resolveTransactionCategory(input: ResolveInput): {
  categoryId: string | null;
  categorizedBy: "recurring" | "rule" | "plaid";
  recurringTransactionId: string | null;
} {
  const claim = resolveRecurringClaim(input.recurrings, {
    merchantName: input.merchantName,
    name: input.name,
    amount: input.amount,
    date: input.date,
  });
  if (claim) {
    return {
      categoryId: claim.categoryId,
      categorizedBy: "recurring",
      recurringTransactionId: claim.recurringId,
    };
  }

  const ruleHit = resolveRuleCategory(input.rules, {
    merchantName: input.merchantName,
    name: input.name,
  });
  if (ruleHit) {
    return { categoryId: ruleHit.categoryId, categorizedBy: "rule", recurringTransactionId: null };
  }

  const slug = mapPfcToSlug(input.pfcPrimary, input.pfcDetailed);
  const pfcId = slug ? input.slugToId.get(slug) ?? null : null;
  return { categoryId: pfcId, categorizedBy: "plaid", recurringTransactionId: null };
}
