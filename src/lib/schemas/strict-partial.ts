import { z } from "zod";

/**
 * Zod 4 partial-schema helpers.
 *
 * ## Why this exists
 *
 * This repo is on Zod 4, where `.optional()` **wraps** a `ZodDefault` rather
 * than removing it — so the default still fires on an **absent** key:
 *
 * ```ts
 * z.object({ b: z.string().default("BOOM") }).partial().parse({})
 * //  →  { b: "BOOM" }     (Zod 3 gave `{}`)
 * ```
 *
 * `.partial()` is a shape-wide `.optional()` map, so it inherits the flaw.
 *
 * That is quietly catastrophic when paired with our PATCH route idiom. Routes
 * are written either as `if (input.X !== undefined) patch.X = input.X` — where
 * the guard passes, because an injected key is *not* undefined — or as a
 * wholesale `.set({ ...parsed.data })`. Either way, every injected default gets
 * **written**, so a one-key PATCH silently overwrites fields the caller never
 * sent. Where a route full-replaces an array field, an injected `[]` deletes
 * every row.
 *
 * `z.infer` gives no warning: a schema that type-checks as `Partial<T>` parses
 * to a full object. That is what makes the bug invisible in review.
 *
 * The behaviour is pinned by a control test in
 * `__tests__/strict-partial.test.ts`, and `update-schema-defaults.contract.test.ts`
 * asserts no exported update schema in the repo reintroduces it.
 */

/** Recursively unwrap the wrapper types that can resurrect a value for an absent key. */
type Unwrapped<T> =
  T extends z.ZodDefault<infer Inner>
    ? Unwrapped<Inner>
    : T extends z.ZodOptional<infer Inner>
      ? Unwrapped<Inner>
      : T;

type StrictPartialShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<Unwrapped<S[K]>>;
};

/**
 * Peel every `ZodDefault` / `ZodOptional` wrapper off a schema, exposing the
 * inner type so a re-applied `.optional()` genuinely means "may be absent".
 *
 * A `while` loop, not an `if`: the wrappers nest. `.optional().default(0)`
 * produces `ZodDefault(ZodOptional(ZodNumber))`, and the reverse ordering
 * `.default(0).optional()` produces `ZodOptional(ZodDefault(ZodNumber))` —
 * where peeling only the outermost layer would leave the default in place.
 *
 * `ZodNullable` is deliberately NOT unwrapped: nullability is part of the
 * field's contract, and `null` is a value a caller can legitimately send.
 */
export function stripDefault(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    current = (current as z.ZodDefault<z.ZodTypeAny> | z.ZodOptional<z.ZodTypeAny>).def
      .innerType;
  }
  return current;
}

/**
 * The `.partial()` you actually wanted: every key becomes optional AND its
 * create-time default is stripped, so parsing a body returns exactly the keys
 * that body contained.
 *
 * Use this for every PATCH/update schema derived from a create schema. Create
 * schemas must KEEP their defaults — a create body is complete and the insert
 * paths rely on them.
 *
 * ```ts
 * export const updateFooSchema = strictPartial(createFooSchema);
 * strictPartial(createFooSchema).parse({})            // → {}
 * strictPartial(createFooSchema).parse({ name: "x" }) // → { name: "x" }
 * ```
 *
 * Returns a `ZodObject`, so `.superRefine()` / `.extend()` / `.omit()` still
 * chain, and `z.infer` reports an honest all-optional type.
 *
 * ⚠️ Not appropriate where a route *depends* on the injected value. The wills
 * PATCH endpoint is a deliberate full-replacement API: it destructures
 * `bequests` unguarded and delete-then-reinserts, so its `[]` default is
 * load-bearing and it is allowlisted in the contract test.
 */
export function strictPartial<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): z.ZodObject<StrictPartialShape<T["shape"]>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => [
      key,
      stripDefault(value as z.ZodTypeAny).optional(),
    ]),
  );
  return z.object(shape) as unknown as z.ZodObject<StrictPartialShape<T["shape"]>>;
}
