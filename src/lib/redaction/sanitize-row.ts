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
 * It will surface last-4 account numbers. `sanitizeRow` itself never touches
 * dates of birth in EITHER mode — that redaction, where it exists, is done by
 * the caller (see `src/domain/mcp/tools/household.ts`'s `redactFamilyMemberDob`
 * and R43). Full SSNs and full account numbers are never exposed in either
 * mode.
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
  // F1: a `Date` has no own enumerable properties, so the generic
  // `Object.entries` branch below silently rebuilds it as `{}` — every
  // drizzle `timestamp` column (createdAt/updatedAt/completedAt, etc.)
  // degrades to an empty object on every tool response. Must come before the
  // `typeof === "object"` branch, which would otherwise swallow it first.
  if (value instanceof Date) return value.toISOString();
  // A `Set` degrades the same way (no own enumerable properties) and is
  // safe to unwrap the same way an array is: order-preserving, string-free
  // of any key-coercion choice. A `Map` is deliberately NOT handled here —
  // its keys can be anything (numbers, dates, objects), so collapsing it to
  // a plain object would require picking a key-coercion convention no
  // caller has asked for, and no known row in this codebase ever puts a
  // `Map` on a field a tool returns. Left alone rather than guessed at.
  if (value instanceof Set) return [...value].map((v) => sanitizeRow(v, mode));
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
