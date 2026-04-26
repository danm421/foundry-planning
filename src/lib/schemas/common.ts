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

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Must be ISO 8601 date");

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
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
