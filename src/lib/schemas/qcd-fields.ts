import { z } from "zod";
import { uuidSchema } from "./common";

/** A QCD (qualified charitable distribution) is a gift paid straight from an IRA
 *  to a public charity. Its two columns are set together or not at all — the DB
 *  CHECKs `gifts_qcd_shape` / `gift_series_qcd_shape` enforce the same. Shared by
 *  the one-time gift and the gift-series schemas. */
export const qcdAccountIdField = uuidSchema.nullable().optional();
export const qcdAmountModeField = z.enum(["fixed", "full_rmd"]).nullable().optional();

export const QCD_NEEDS_BOTH = "A QCD needs both the IRA and the amount mode";
export const QCD_MUST_BE_CHARITY = "A QCD must go to a charity";
export const QCD_NO_TRANSFER = "A QCD can't also transfer an account";
export const QCD_ONE_GIVER = "A QCD has one giver — the IRA's owner";
export const QCD_NO_ANNUAL_EXCLUSION = "A QCD can't use the annual-exclusion amount";

export const QCD_FULL_RMD_AMOUNT = "A full-RMD QCD takes no amount — the RMD sets it";
export const QCD_FIXED_AMOUNT = "A fixed QCD needs an amount greater than zero";

/** Amount rule: a full-RMD QCD stores 0, a fixed one needs a positive amount. */
export function qcdAmountIssue(
  mode: "fixed" | "full_rmd",
  amount: number | null | undefined,
): string | null {
  if (mode === "full_rmd") return amount === 0 ? null : QCD_FULL_RMD_AMOUNT;
  return amount != null && amount > 0 ? null : QCD_FIXED_AMOUNT;
}

/** True when the patch sets exactly one of the two fields to null/absent while
 *  the other is a value — a half-QCD. Both-null (clear) and both-set are fine. */
export function isHalfQcd(d: {
  qcdAccountId?: string | null;
  qcdAmountMode?: string | null;
}): boolean {
  const a = d.qcdAccountId != null;
  const m = d.qcdAmountMode != null;
  return a !== m;
}
