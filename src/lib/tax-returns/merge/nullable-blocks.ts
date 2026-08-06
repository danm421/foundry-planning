import {
  emptyAdjustmentsDetail,
  emptyQbi,
  emptyScheduleA,
  emptyScheduleE,
} from "@/lib/schemas/tax-return-facts";

/**
 * Nullable blocks that must be materialized from a factory, never `{}`,
 * before a write can land inside them. Every field in these blocks is
 * `.nullable()` with no `.optional()`/`.default()`, so the strict schema
 * REQUIRES every key — seeding `{}` and filling only the touched field
 * leaves the rest `undefined`, which fails `taxReturnFactsSchema` (and, once
 * persisted, fails `parseRowFacts` on the next read). Keyed by the dotted
 * path to the block itself, checked while a caller walks the path's prefix.
 *
 * Shared by `merge-documents.ts` (materializing a block from a document
 * write) and `overrides.ts` (materializing a block from an advisor edit) —
 * one table so the two can never drift and seed a block the other can't
 * write into.
 */
export const NULLABLE_BLOCK_FACTORIES: Readonly<Record<string, () => object>> = {
  "income.scheduleE": emptyScheduleE,
  "income.adjustmentsDetail": emptyAdjustmentsDetail,
  "deductions.scheduleA": emptyScheduleA,
  "deductions.qbi": emptyQbi,
};
