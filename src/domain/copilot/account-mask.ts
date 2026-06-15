/** Mask an account number to •••• + last 4. Short numbers are fully masked.
 *  Ported from ethos src/domain/households/account-mask.ts so copilot tool
 *  output never echoes a full account number. */
export function maskAccountNumber(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return "••••" + s.slice(-4);
}
