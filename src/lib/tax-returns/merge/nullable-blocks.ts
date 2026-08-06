import {
  emptyAdjustmentsDetail,
  emptyBusiness,
  emptyK1,
  emptyQbi,
  emptyScheduleA,
  emptyScheduleE,
} from "@/lib/schemas/tax-return-facts";
import type { EntityCollection } from "./types";

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

/**
 * All-null template for one entity, by collection. `applyOverrides` needs it to
 * materialize an advisor-CREATED entity, for the same reason the table above
 * exists: both entity schemas are `.strict()` with every key required, so an
 * entity built from `{}` and filled only where the advisor typed something
 * fails `taxReturnFactsSchema` and, once persisted, blanks the whole tab.
 */
export const ENTITY_FACTORIES: Readonly<Record<EntityCollection, () => object>> = {
  businesses: emptyBusiness,
  k1s: emptyK1,
};
