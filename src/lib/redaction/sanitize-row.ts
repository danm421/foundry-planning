import { redactSsns } from "@/lib/extraction/redact-ssn";
import { maskAccountNumber } from "@/domain/forge/account-mask";

/**
 * How much identity may leave the server.
 *
 * `strict` is the default and the only mode used by Forge and by the MCP
 * server today: account numbers collapse to a masked last-4 and SSNs are
 * redacted from every string at any depth.
 *
 * `identifiers-allowed` is reserved for the per-firm MCP flag (spec phase 3).
 * It will surface last-4 account numbers and exact dates of birth. Full SSNs
 * and full account numbers are never exposed in either mode.
 */
export type RedactionMode = "strict" | "identifiers-allowed";

/** Account-number-bearing fields are masked to last-4 before the model sees them. */
const ACCOUNT_NUMBER_FIELDS = new Set(["accountNumber", "accountNumberRaw"]);

/**
 * Recursively sanitize a detail row before it leaves the server: redact SSNs
 * from every string, and collapse any account-number field to a masked
 * last-4 value (`accountNumber`). Walks arrays and nested objects so a leaked
 * SSN or raw account number anywhere in the row is caught.
 */
export function sanitizeRow(value: unknown, mode: RedactionMode = "strict"): unknown {
  if (typeof value === "string") return redactSsns(value).text;
  if (Array.isArray(value)) return value.map((v) => sanitizeRow(v, mode));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ACCOUNT_NUMBER_FIELDS.has(k)) {
        // Coerce to string first: a numeric account number must be masked too,
        // never echoed raw or crash maskAccountNumber's .trim().
        out.accountNumber = maskAccountNumber(v == null ? null : String(v));
      } else {
        out[k] = sanitizeRow(v, mode);
      }
    }
    return out;
  }
  return value;
}
