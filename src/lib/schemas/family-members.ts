// src/lib/schemas/family-members.ts
//
// CLIENT-SAFE: reached from a "use client" component through
// `entity-writer/create-schemas.ts`. Import nothing but zod.
import { z } from "zod";

export const FAMILY_RELATIONSHIPS = [
  "child", "stepchild", "grandchild", "great_grandchild", "parent",
  "grandparent", "sibling", "sibling_in_law", "child_in_law",
  "niece_nephew", "aunt_uncle", "cousin", "grand_aunt_uncle", "other",
] as const;

/**
 * A real calendar date in `yyyy-mm-dd` — the only form the Postgres `date`
 * column takes, the only form `<input type="date">` can submit, and the only
 * form the extractor emits (`placement.ts`'s `date` case rewrites `13/45/2020`
 * into `2020-13-45` and FAILs anything it cannot shape).
 *
 * ⚠️ The shape alone is NOT enough, which is why this is not a bare regex:
 * `\d{2}` happily matches month `13` and day `45`, so `2020-13-45` passes any
 * `^\d{4}-\d{2}-\d{2}$` test — this repo's own `isoDate` included — and reaches
 * the date column as a 500. The round trip through `Date.UTC` is what rejects
 * it: an out-of-range month or day rolls over to a different date, so
 * comparing the parts back catches `2020-13-45`, `2020-00-00`, `2020-02-31`
 * and a Feb 29 in a non-leap year alike.
 */
function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

const nullableDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v))
  .refine((v) => v === null || isCalendarDate(v), "Must be a real date in yyyy-mm-dd form");

const INHERITANCE_STATES = ["PA", "NJ", "KY", "NE", "MD"] as const;
const INHERITANCE_CLASSES = ["A", "B", "C", "D"] as const;
type InheritanceClassOverride = Partial<
  Record<(typeof INHERITANCE_STATES)[number], (typeof INHERITANCE_CLASSES)[number]>
>;

/**
 * ⚠️ `partialRecord`, NOT `record`. In Zod 4 a `z.record()` keyed by an enum is
 * EXHAUSTIVE — `{ PA: "A" }` fails with one issue per state the advisor never
 * touched. `family-member-dialog.tsx` writes a key only for the states an
 * advisor actually picked a class for, so `record` would 400 a correctly
 * filled-in form. An explicit `null` is accepted too, because the route's
 * insert has always read `inheritanceClassOverride ?? {}`.
 */
const inheritanceClassOverride = z
  .union([z.partialRecord(z.enum(INHERITANCE_STATES), z.enum(INHERITANCE_CLASSES)), z.null()])
  .optional()
  .transform((v): InheritanceClassOverride => v ?? {});

export const familyMemberCreateSchema = z.object({
  // Both messages, deliberately: the advisor sees this sentence on the review
  // surface prefixed with the field's label, and zod's own wording for a
  // MISSING key ("expected string, received undefined") reads as a leak.
  firstName: z.string("First name is required").min(1, "First name is required"),
  lastName: z.string().nullish().transform((v) => v ?? null),
  relationship: z.enum(FAMILY_RELATIONSHIPS).default("child"),
  dateOfBirth: nullableDate,
  notes: z.string().nullish().transform((v) => v ?? null),
  domesticPartner: z.boolean().default(false),
  inheritanceClassOverride,
});

export type FamilyMemberCreateInput = z.infer<typeof familyMemberCreateSchema>;
