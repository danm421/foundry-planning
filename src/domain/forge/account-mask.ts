/** Mask an account number to •••• + last 4. Short numbers are fully masked.
 *  Ported from ethos src/domain/households/account-mask.ts so forge tool
 *  output never echoes a full account number. */
export function maskAccountNumber(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return "••••" + s.slice(-4);
}

/** Render an SSN as •••-••-#### using only the last 4 digits. A presentation
 *  guard: even if a caller hands more than 4 digits, we surface at most 4. */
export function maskSsnLast4(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\D/g, "");
  if (!s) return "";
  return "•••-••-" + s.slice(-4).padStart(4, "•");
}
