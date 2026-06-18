import type { ZodType } from "zod";

/**
 * Validate a tool's RETURN value against a schema; retry ONCE on failure, then
 * surface a safe error string. Hard-capped at one retry — an unbounded loop would
 * inflate Azure cost. Returns a JSON string (tools return strings to the model).
 */
export async function withOutputRetry<T>(
  fn: () => Promise<unknown>,
  schema: ZodType<T>,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await fn();
    const parsed = schema.safeParse(raw);
    if (parsed.success) return JSON.stringify(parsed.data);
  }
  return "I couldn't produce a valid result for that calculation. Please try again or adjust the inputs.";
}
