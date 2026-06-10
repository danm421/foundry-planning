// src/lib/solver/solve-request-schema.ts
//
// Zod schema for the POST /api/clients/[id]/solver/solve request body. Extracted
// from the route so validation (notably the targetPoS refine) is unit-testable
// without standing up the SSE handler.

import { z } from "zod";
import { SOLVER_MUTATION_SCHEMA } from "./mutation-schema";

export const SOLVE_TARGET_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("retirement-age"), person: z.enum(["client", "spouse"]) }),
  z.object({ kind: z.literal("living-expense-scale") }),
  z.object({ kind: z.literal("savings-contribution"), accountId: z.string().min(1) }),
  z.object({ kind: z.literal("ss-claim-age"), person: z.enum(["client", "spouse"]) }),
  z.object({
    kind: z.literal("roth-conversion-amount"),
    techniqueId: z.string().min(1),
  }),
]);

export const SOLVE_REQUEST_SCHEMA = z
  .object({
    source: z.union([z.literal("base"), z.string().uuid()]),
    mutations: z.array(SOLVER_MUTATION_SCHEMA),
    target: SOLVE_TARGET_SCHEMA,
    // Optional: required only for the PoS-bisection levers. The deterministic
    // ss-claim-age solve has no target PoS.
    targetPoS: z.number().min(0.01).max(0.99).optional(),
    // Optional per-account asset mixes for synthetic (non-DB) accounts injected
    // by the solver (e.g. the "Additional Savings" account). Forwarded to
    // loadMonteCarloData so their asset classes reach the MC correlation matrix.
    extraAccountMixes: z
      .array(
        z.object({
          accountId: z.string().min(1),
          mix: z.array(z.object({ assetClassId: z.string().min(1), weight: z.number() })),
        }),
      )
      .optional(),
  })
  .refine(
    (b) => b.target.kind === "ss-claim-age" || b.targetPoS !== undefined,
    { message: "targetPoS is required for this solve target", path: ["targetPoS"] },
  );
