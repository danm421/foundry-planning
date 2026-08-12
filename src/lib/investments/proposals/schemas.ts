import { z } from "zod";

const adHocHolding = z.object({
  ticker: z.string().optional(),
  name: z.string().optional(),
  shares: z.number().optional(),
  price: z.number().optional(),
  marketValue: z.number().optional(),
  costBasis: z.number().optional(),
});

export const proposalSourceSchema = z.union([
  z.object({ accountIds: z.array(z.string().uuid()).min(1) }),
  z.object({ adHoc: z.object({ taxable: z.boolean(), holdings: z.array(adHocHolding).min(1) }) }),
]);

export const proposalTargetSchema = z.union([
  z.object({ portfolioId: z.string().uuid() }),
  // The builder sends decimal fractions (`rebalance-target.tsx` divides the
  // typed percent by 100), so the bounds match the sibling rebalance route
  // exactly. Unbounded, a percent typed straight through — 60 instead of 0.6 —
  // would compute a 6000%-weight portfolio without complaint.
  z.object({
    holdings: z
      .array(z.object({ ticker: z.string().trim().min(1).max(32), weight: z.number().min(0).max(1) }))
      .min(1),
  }),
]);

// The optional fields are `.nullable().optional()`, never `.default(null)`:
// measured on zod 4.3.6, a `.default()` SURVIVES `.partial()`, so
// `proposalUpdateSchema` could not tell "the caller omitted this" from "the
// caller cleared this" and a rename would silently wipe a stored advisory fee.
// Without the default, `.partial()` behaves as expected and the create route
// applies `?? null` at the insert.
export const proposalCreateSchema = z.object({
  name: z.string().min(1).max(200),
  source: proposalSourceSchema,
  target: proposalTargetSchema,
  targetLabel: z.string().min(1).max(200),
  advisoryFeeCurrent: z.number().min(0).max(0.1).nullable().optional(),
  advisoryFeeProposed: z.number().min(0).max(0.1).nullable().optional(),
  overrideLtcgRate: z.number().min(0).max(1).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const proposalUpdateSchema = proposalCreateSchema.partial().extend({
  status: z.enum(["draft", "presented", "accepted"]).optional(),
  /** When true the snapshot is rebuilt from the (possibly updated) inputs. */
  recompute: z.boolean().default(false),
});

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalUpdateInput = z.infer<typeof proposalUpdateSchema>;
