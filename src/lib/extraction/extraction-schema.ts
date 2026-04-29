import { z } from "zod";

/**
 * Strict zod schema for the extraction pipeline's parsed LLM output.
 *
 * Everything consumed from a model response must pass through this
 * schema before it reaches the client UI. The goal is not to type-check
 * every field — the prompt docs and TypeScript types in `types.ts` do
 * that downstream — but to enforce the structural invariant that a
 * compromised / prompt-injected response can't smuggle unexpected
 * top-level shapes through: no new root keys, no oversize arrays, only
 * plain objects in each list.
 *
 * Individual field values use `.passthrough()` so the downstream UI
 * keeps receiving exactly the keys the prompts ask for today, even as
 * prompts evolve.
 */

const maxLenPerList = {
  accounts: 200,
  incomes: 200,
  expenses: 500,
  liabilities: 200,
  entities: 50,
  dependents: 30,
} as const;

const row = z.looseObject({});

const familyMember = z.looseObject({});

const familyPayloadSchema = z
  .object({
    primary: familyMember.optional(),
    spouse: familyMember.optional(),
    dependents: z.array(familyMember).max(maxLenPerList.dependents).optional(),
  })
  .strict()
  .optional();

export const extractedPayloadSchema = z
  .object({
    accounts: z.array(row).max(maxLenPerList.accounts).optional(),
    incomes: z.array(row).max(maxLenPerList.incomes).optional(),
    expenses: z.array(row).max(maxLenPerList.expenses).optional(),
    liabilities: z.array(row).max(maxLenPerList.liabilities).optional(),
    entities: z.array(row).max(maxLenPerList.entities).optional(),
    family: familyPayloadSchema,
  })
  .strict();

export type ExtractedPayload = z.infer<typeof extractedPayloadSchema>;
