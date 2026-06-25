type TxnType = "income" | "expense" | "transfer";

/**
 * Encode a positive form magnitude into the stored Plaid sign convention
 * (positive = money OUT). Income is money in, so it's stored negative;
 * expense and transfer are stored positive. Returns a 2-decimal string,
 * matching the `numeric(15,2)` column.
 */
export function encodeSignedAmount(magnitude: number, type: TxnType): string {
  const m = Math.abs(magnitude);
  const signed = type === "income" ? -m : m;
  return signed.toFixed(2);
}
