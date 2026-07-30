import { describe, it, expect } from "vitest";
import { z } from "zod";
import { stripDefault, strictPartial } from "../strict-partial";

/**
 * Control: pins the Zod 4 behaviour this helper exists to work around.
 *
 * In Zod 3, `ZodOptional` short-circuited on `undefined` and a `.default()`
 * underneath never fired. In Zod 4 (`4.3.6` here) `.optional()` *wraps* the
 * `ZodDefault` instead of removing it, so the default still fires on an ABSENT
 * key — and `.partial()`, which is a shape-wide `.optional()` map, inherits the
 * flaw.
 *
 * If this test ever goes red, Zod fixed it upstream and `strictPartial` can be
 * reconsidered. Until then it is the reason the helper exists.
 */
describe("Zod 4 default-injection control", () => {
  it(".partial() still applies defaults to absent keys", () => {
    const parsed = z.object({ b: z.string().default("BOOM") }).partial().parse({});
    expect(parsed).toEqual({ b: "BOOM" });
  });

  it(".optional() wraps rather than removes a ZodDefault", () => {
    expect(z.string().default("BOOM").optional().parse(undefined)).toBe("BOOM");
  });
});

describe("stripDefault", () => {
  it("peels a single ZodDefault wrapper", () => {
    expect(stripDefault(z.string().default("x")).optional().parse(undefined)).toBeUndefined();
  });

  it("peels NESTED wrappers — `.optional().default(0)` nests two deep", () => {
    // This is the case that makes the loop necessary: `.optional().default(0)`
    // produces ZodDefault(ZodOptional(ZodNumber)), and several schemas in this
    // repo are written that way.
    const nested = z.number().optional().default(0);
    expect(stripDefault(nested).optional().parse(undefined)).toBeUndefined();
  });

  it("leaves a schema with no default untouched", () => {
    const plain = z.string();
    expect(stripDefault(plain)).toBe(plain);
  });
});

describe("strictPartial", () => {
  it("parses an empty body to an EMPTY object — no injected defaults", () => {
    const base = z.object({
      a: z.string(),
      b: z.string().default("BOOM"),
      c: z.number().optional().default(0),
      d: z.array(z.string()).default([]),
    });
    const parsed = strictPartial(base).parse({});
    expect(parsed).toEqual({});
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it("passes through only the keys actually sent", () => {
    const base = z.object({
      name: z.string(),
      count: z.number().default(7),
      flag: z.boolean().optional().default(true),
    });
    const parsed = strictPartial(base).parse({ name: "sent" });
    expect(parsed).toEqual({ name: "sent" });
    expect(Object.keys(parsed)).toHaveLength(1);
  });

  it("still validates the keys that ARE sent", () => {
    const base = z.object({ count: z.number().default(7) });
    expect(strictPartial(base).safeParse({ count: "nope" }).success).toBe(false);
  });

  it("returns a ZodObject so .superRefine() and .extend() still chain", () => {
    const base = z.object({ a: z.number().default(1), b: z.number().default(2) });

    const refined = strictPartial(base).superRefine((v, ctx) => {
      if (v.a !== undefined && v.b !== undefined && v.a > v.b) {
        ctx.addIssue({ code: "custom", message: "a must be <= b" });
      }
    });
    expect(refined.parse({})).toEqual({});
    expect(refined.safeParse({ a: 5, b: 1 }).success).toBe(false);

    const extended = strictPartial(base).extend({ c: z.string() });
    expect(extended.parse({ c: "x" })).toEqual({ c: "x" });
  });

  it("preserves nullable fields as nullable", () => {
    const base = z.object({ note: z.string().nullable().default(null) });
    const s = strictPartial(base);
    expect(s.parse({})).toEqual({});
    expect(s.parse({ note: null })).toEqual({ note: null });
  });
});
