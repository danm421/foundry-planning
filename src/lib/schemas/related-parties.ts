// src/lib/schemas/related-parties.ts
//
// The external people a client's documents name — trustees, executors, powers
// of attorney, CPAs, attorneys — stored as `crm_household_contacts` rows.
//
// CLIENT-SAFE: reached from a "use client" component through
// `entity-writer/create-schemas.ts`. Import nothing but zod.
import { z } from "zod";

/** A nullable text column on CREATE: an absent key stores NULL, because a
 *  create body is complete and the insert writes every column. */
const createText = z.string().nullish().transform((v) => v ?? null);

/** The same column on UPDATE: an absent key is LEFT ALONE and an explicit
 *  `null` clears it. See `relatedPartyUpdateSchema` for why this cannot be
 *  `createText` made optional. */
const updateText = z.string().nullable().optional();

/**
 * `role` is fixed to "other". `crm_household_contacts` carries unique partial
 * indexes allowing exactly one `primary` and one `spouse` per household, and
 * the client and spouse are owned by the household diff surface. A row from a
 * document must never contend for those slots.
 *
 * Both names are required because the table requires both: `first_name` and
 * `last_name` are each `.notNull()`.
 */
export const relatedPartyCreateSchema = z.object({
  role: z.literal("other").default("other"),
  // Both messages, deliberately — the shape `familyMemberCreateSchema` settled
  // on. A document naming "Trustee: Ada" omits the last name ENTIRELY, and
  // zod's own wording for a missing key ("expected string, received
  // undefined") reads as a leak on the review surface the advisor sees.
  firstName: z.string("First name is required").min(1, "First name is required"),
  lastName: z.string("Last name is required").min(1, "Last name is required"),
  relationshipLabel: createText,
  email: createText,
  phone: createText,
  mobile: createText,
  employer: createText,
  occupation: createText,
  notes: createText,
});

/**
 * NOT `relatedPartyCreateSchema.partial()`, and not `strictPartial()` either.
 *
 * `createText` is `z.string().nullish().transform(v => v ?? null)` — a ZodPipe,
 * and the pipe RUNS for an absent key, mapping `undefined` to `null`. Wrapping
 * it in `.optional()` does not stop that, so both derivations turn a one-key
 * PATCH into a write of `null` over every other column: sending just a phone
 * number would wipe the contact's email, employer and notes. `strictPartial`
 * peels `ZodDefault`/`ZodOptional` wrappers only, so a pipe survives it intact
 * — which is why the repo-wide guard in
 * `__tests__/update-schema-defaults.contract.test.ts` catches this derivation
 * and why the shape is written out here instead.
 *
 * `role` and `householdId` are absent on purpose: a related party stays
 * "other" in the household it was created in, and neither is the PATCH's to
 * move.
 */
export const relatedPartyUpdateSchema = z.object({
  firstName: z.string("First name is required").min(1, "First name is required").optional(),
  lastName: z.string("Last name is required").min(1, "Last name is required").optional(),
  relationshipLabel: updateText,
  email: updateText,
  phone: updateText,
  mobile: updateText,
  employer: updateText,
  occupation: updateText,
  notes: updateText,
});

export type RelatedPartyCreateInput = z.infer<typeof relatedPartyCreateSchema>;
