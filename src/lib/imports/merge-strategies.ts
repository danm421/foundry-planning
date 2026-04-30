/**
 * Field-level merge strategies used by the commit step (Phase 6) when
 * an incoming row maps to an existing canonical row. The matching pass
 * produces the {existing, incoming} pair; this module decides how to
 * combine their fields.
 *
 * - "replace": always take the incoming value when defined (null and
 *   empty strings are real values that override).
 * - "replace-if-non-null": take the incoming value only when it is
 *   meaningful — null, undefined, and empty string skip. `false` and
 *   `0` are kept (a numeric zero is meaningful, e.g. "no growth").
 * - "keep-existing": never overwrite. Useful for fields the import
 *   shouldn't clobber (e.g. user-tuned growth rates).
 */
export type FieldStrategy = "replace" | "replace-if-non-null" | "keep-existing";

export type FieldMap<T> = Partial<Record<keyof T, FieldStrategy>>;

export function applyMerge<T extends object>(
  existing: T,
  incoming: Partial<T>,
  map: FieldMap<T>,
): T {
  const out = { ...existing };
  for (const [key, strategy] of Object.entries(map) as Array<[keyof T, FieldStrategy]>) {
    const incomingVal = incoming[key];
    switch (strategy) {
      case "replace":
        if (incomingVal !== undefined) {
          out[key] = incomingVal as T[keyof T];
        }
        break;
      case "replace-if-non-null":
        if (
          incomingVal !== undefined &&
          incomingVal !== null &&
          incomingVal !== ""
        ) {
          out[key] = incomingVal as T[keyof T];
        }
        break;
      case "keep-existing":
        break;
    }
  }
  return out;
}
