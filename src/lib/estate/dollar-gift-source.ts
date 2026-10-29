import { isFullyEntityOwned, type OwnedThing } from "@/engine/ownership";

/** Why an account can't pay a dollar gift — the will routes' refusal codes. */
export type DollarSourceRefusal = "dollar_bequest_source_not_cash" | "dollar_bequest_source_entity_owned";

/**
 * Which account a dollar gift may name: the one rule the will dialog's
 * "Paid from" picker (through `canPayDollarGift`, set by the wills
 * `load-view-props.ts`) and the write core (`verifyCrossRefs` in
 * `wills-writes.ts`) both apply.
 *
 * It follows what the engine pays a dollar gift from: cash or brokerage
 * (`ELIGIBLE` in `src/engine/death-event/will-gifts.ts`) that reaches the
 * will's pool. An account wholly owned by trusts or businesses never does —
 * the death chains keep it as it is — so it is refused. One a trust owns only
 * part of routes the household's share through the will, so it can pay a gift.
 */
export function dollarSourceRefusal(account: { category: string } & OwnedThing): DollarSourceRefusal | null {
  if (account.category !== "cash" && account.category !== "taxable") return "dollar_bequest_source_not_cash";
  if (isFullyEntityOwned(account)) return "dollar_bequest_source_entity_owned";
  return null;
}

/** The refusals as the advisor reads them on the will page. */
export const DOLLAR_SOURCE_REFUSAL_TEXT: Readonly<Record<DollarSourceRefusal, string>> = {
  dollar_bequest_source_not_cash:
    "A dollar gift is paid from cash or brokerage. Pick a cash or brokerage account owned by the client.",
  dollar_bequest_source_entity_owned:
    "A trust or business owns that account, so the will can't pay a gift from it. Pick a cash or brokerage account owned by the client.",
};
