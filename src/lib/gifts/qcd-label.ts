import type { QcdAmountMode } from "@/engine/types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** One-line label for a QCD gift row in the gift lists. */
export function qcdGiftLabel(input: {
  accountName: string;
  amountMode: QcdAmountMode;
  amount: number;
  recurring: boolean;
}): string {
  const { accountName, amountMode, amount, recurring } = input;
  const what =
    amountMode === "full_rmd"
      ? "Full RMD"
      : `${usd.format(amount)}${recurring ? "/yr" : ""}`;
  return `QCD from ${accountName} · ${what}`;
}
