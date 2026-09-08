import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Shared zod building blocks and the request-body helper every route uses.
 *
 * The pattern: each mutating handler imports a resource-specific schema
 * from `src/lib/schemas/<resource>.ts`, calls `parseBody(schema, req)`,
 * and either returns the 400 Response or proceeds with fully-typed data.
 *
 * Why .strict() everywhere: drizzle silently ignores unknown keys, but a
 * strict schema rejects them at the edge so attackers can't probe for
 * shadow columns and new features don't accidentally leak through the
 * schema without being added to the allowlist.
 */

// UUIDs from `uuid().defaultRandom()`. Kept loose (min 1) so tests that
// use plain strings don't have to contort, but tightens the attacker
// vocabulary — no objects or arrays.
export const uuidLike = z.string().min(1).max(128);

// Strict RFC-4122 UUID. Use for FK references that must be real UUIDs
// (entity ids, family-member ids, etc.). uuidLike remains available for
// contexts where tests pass short plain-string ids.
export const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

// Money and rates. Accept number or numeric string; reject NaN / Infinity.
const finiteNumber = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Must be a finite number" });
      return z.NEVER;
    }
    return n;
  });

export const money = finiteNumber.refine(
  (n) => n >= -1e12 && n <= 1e12,
  "Value out of range"
);

export const growthRate = finiteNumber.refine(
  (n) => n >= -1 && n <= 10,
  "Growth rate must be between -100% and 1000%"
);

export const year = z.number().int().min(1900).max(2200);

/**
 * Lack-of-marketability / lack-of-control valuation discount on a gift, as a
 * FRACTION (0.3 = 30%). Null or absent means "no discount", which behaves
 * identically to 0. Shared by `gifts` and `gift_series` — both store it in a
 * `numeric(6,4)` column guarded by `CHECK (d IS NULL OR (d >= 0 AND d < 1))`.
 *
 * Why the upper bound is 0.99995 and not 1: Postgres coerces the value to
 * `numeric(6,4)` — rounding half AWAY FROM ZERO at 4 decimal places — BEFORE it
 * evaluates the CHECK. So 0.99995 is stored as 1.0000 and then trips the CHECK.
 * A bound of `.lt(1)` would let the whole window [0.99995, 1) through Zod and
 * turn a should-have-been-400 into a 500 at the database. 0.9999 is the largest
 * discount `numeric(6,4)` can hold below 1, so the last value that survives the
 * round trip is anything strictly under 0.99995. (The sibling `percent` column
 * has no equivalent hole because its bound is `lte(1)`, which tolerates the
 * rounding.) Keep this in step with the table CHECK in `src/db/schema.ts`.
 */
export const valuationDiscount = z.number().gte(0).lt(0.99995).optional().nullable();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Must be ISO 8601 date");

/** Sanitize a ZodError to path+message pairs only — never echo received values
 *  (they can embed internal IDs / PII) or internal Zod codes back to the client. */
export function formatZodIssues(
  error: z.ZodError
): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** One-line summary of a ZodError for the entity write cores' `writeError(400, …)`.
 *  Keeps the field NAME on the front of each issue — without it a missing required
 *  field reads as the useless "Invalid input; Invalid input: expected number,
 *  received undefined", which is what an advisor saw when a Forge write tool was
 *  called with a required field omitted. Path-free issues (whole-object refinements)
 *  keep their bare message. Same sanitization posture as formatZodIssues: path +
 *  message only, never the received value. */
export function summarizeZodIssues(error: z.ZodError): string {
  return formatZodIssues(error)
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ");
}

/**
 * Parse `req.json()` against `schema`. Returns either the validated data
 * or a 400 NextResponse that the handler should return immediately.
 */
export async function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: { json(): Promise<unknown> }
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Validation failed",
          issues: formatZodIssues(parsed.error),
        },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
