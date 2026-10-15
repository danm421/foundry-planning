// src/lib/fact-finder/placement/text.ts
/**
 * Small readers and labels the placement modules and the record book share: a
 * value read as a string or a number, a person's full name, a name with its
 * last 4. Pure and client-safe.
 */

/** A string, trimmed; null when it isn't one or is blank. */
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A string as it is, blank included; null when it isn't one. */
export const stringOf = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A number; null when it isn't one. */
export const numberOf = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** "Mark Hendricks": the names there are, joined. */
export const fullName = (first: string | null, last: string | null): string => [first, last].filter(Boolean).join(" ");

/** "Joint Checking ··1234", as the fact finder's link picker shows it; the name alone with no last 4. */
export const withLast4 = (name: string, last4: string | null | undefined): string => (last4 ? `${name} ··${last4}` : name);
