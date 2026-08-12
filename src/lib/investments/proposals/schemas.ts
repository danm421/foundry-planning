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
  z.object({ holdings: z.array(z.object({ ticker: z.string().min(1), weight: z.number() })).min(1) }),
]);

// Zod 4: declare a default with .default() ALONE. `.optional().default()`
// wraps the default and hands the handler `undefined`.
export const proposalCreateSchema = z.object({
  name: z.string().min(1).max(200),
  source: proposalSourceSchema,
  target: proposalTargetSchema,
  targetLabel: z.string().min(1).max(200),
  advisoryFeeCurrent: z.number().min(0).max(0.1).nullable().default(null),
  advisoryFeeProposed: z.number().min(0).max(0.1).nullable().default(null),
  overrideLtcgRate: z.number().min(0).max(1).nullable().default(null),
  notes: z.string().max(4000).nullable().default(null),
});

export const proposalUpdateSchema = proposalCreateSchema.partial().extend({
  status: z.enum(["draft", "presented", "accepted"]).optional(),
  /** When true the snapshot is rebuilt from the (possibly updated) inputs. */
  recompute: z.boolean().default(false),
});

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalUpdateInput = z.infer<typeof proposalUpdateSchema>;
