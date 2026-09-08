import { z } from "zod";
import { valuationDiscount } from "./common";

/**
 * Body schema for POST /api/clients/[id]/entities/[entityId]/assets — assign,
 * re-percent, or remove an asset against a trust.
 *
 * Mirrors `AssetTabOp` from `src/components/forms/asset-tab-ops.ts` so the same
 * UI op flows through the route unchanged. It lives here rather than in the
 * route file so it sits beside the other gift-carrying schemas and can join the
 * shared `valuationDiscount` bounds table in
 * `src/lib/schemas/__tests__/gifts-valuation-discount.test.ts`.
 *
 * NOTE the scale mismatch, which is deliberate: `percent` is 0-100 here for
 * historical reasons, while `valuationDiscount` is a FRACTION (0.3 = 30%)
 * matching the gifts.valuation_discount column and every other surface. The
 * shared bound also keeps the [0.99995, 1) window out — see ./common.
 */
export const assetOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
    percent: z.number().min(0).max(100),
    valuationDiscount,
  }),
  z.object({
    op: z.literal("remove"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
  }),
  z.object({
    op: z.literal("set-percent"),
    assetType: z.enum(["account", "liability", "entity"]),
    assetId: z.string().uuid(),
    percent: z.number().min(0).max(100),
    // Currently UNREACHABLE: every `set-percent` on an entity is rejected with
    // an unconditional 400 in the route, before this field is ever read. Kept
    // for union symmetry with `AssetTabOp`, so that when set-percent is wired
    // the discount arrives with it rather than being a second migration.
    valuationDiscount,
  }),
]);

export type AssetOp = z.infer<typeof assetOpSchema>;
