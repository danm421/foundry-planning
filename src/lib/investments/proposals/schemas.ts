import { z } from "zod";
import { strictPartial } from "@/lib/schemas/strict-partial";

// These mirror the sibling `clients/[id]/rebalance/compute` route's body schema,
// which computes the same numbers from the same shapes. The bounds are not
// cosmetic: a negative `marketValue` makes `totalValue` — and so every dollar
// figure in the frozen, persisted snapshot — nonsense with no error raised, and
// an unbounded holdings array on a `maxDuration = 300` route is an authenticated
// compute-exhaustion surface.
const money = z.number().finite().min(0).max(1e12);

/** One position in an outside portfolio. Untickered rows (bonds, cash) carry a
 *  name instead; at least one of the two must identify the row. */
const adHocHolding = z
  .object({
    ticker: z.string().trim().max(32).optional(),
    name: z.string().trim().max(200).optional(),
    shares: z.number().finite().min(0).max(1e12).optional(),
    price: money.optional(),
    marketValue: money.optional(),
    costBasis: money.optional(),
  })
  .strict()
  .refine((h) => Boolean(h.ticker) || Boolean(h.name), {
    message: "Each holding needs a ticker or a name",
  });

export const proposalSourceSchema = z.union([
  z.object({ accountIds: z.array(z.string().uuid()).min(1) }).strict(),
  z
    .object({
      adHoc: z
        .object({ taxable: z.boolean(), holdings: z.array(adHocHolding).min(1).max(500) })
        .strict(),
    })
    .strict(),
]);

export const proposalTargetSchema = z.union([
  z.object({ portfolioId: z.string().uuid() }).strict(),
  // The builder sends decimal fractions (`rebalance-target.tsx` divides the
  // typed percent by 100), so the bounds match the sibling rebalance route
  // exactly. Unbounded, a percent typed straight through — 60 instead of 0.6 —
  // would compute a 6000%-weight portfolio without complaint.
  z
    .object({
      holdings: z
        .array(
          z
            .object({ ticker: z.string().trim().min(1).max(32), weight: z.number().min(0).max(1) })
            .strict(),
        )
        .min(1),
    })
    .strict(),
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

// `strictPartial`, not `.partial()` — Zod 4 keeps a `.default()` alive under
// `.optional()`, so `.partial()` would inject `recompute: false` into every
// parsed body and make an omitted key indistinguishable from an explicit
// `false`. `recompute` genuinely defaults to `false` when the caller omits
// it, but that fallback is applied at the PUT route, not the schema — see
// `src/app/api/clients/[id]/investment-proposals/[pid]/route.ts`.
export const proposalUpdateSchema = strictPartial(proposalCreateSchema).extend({
  status: z.enum(["draft", "presented", "accepted"]).optional(),
  /** When true the snapshot is rebuilt from the (possibly updated) inputs. */
  recompute: z.boolean().optional(),
});

export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;
export type ProposalUpdateInput = z.infer<typeof proposalUpdateSchema>;
