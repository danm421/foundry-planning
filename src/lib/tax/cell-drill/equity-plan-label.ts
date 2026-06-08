import type { GrantType, StockOptionPlan } from "@/engine/equity/types";

const GRANT_TYPE_LABEL: Record<GrantType, string> = {
  rsu: "RSU",
  nqso: "NQSO",
  iso: "ISO",
};

/**
 * Display label for an equity plan in the tax drill-down, reflecting its grant
 * type(s): "<ticker> RSU" / "NQSO" / "ISO" for a homogeneous plan, or
 * "<ticker> equity" when the plan mixes grant types (or has none).
 */
export function equityPlanLabel(
  plan: Pick<StockOptionPlan, "ticker" | "accountId" | "grants">,
): string {
  const base = plan.ticker ?? plan.accountId;
  const types = new Set(plan.grants.map((g) => g.grantType));
  if (types.size === 1) {
    const [only] = types;
    return `${base} ${GRANT_TYPE_LABEL[only]}`;
  }
  return `${base} equity`;
}
