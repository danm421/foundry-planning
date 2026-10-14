// src/lib/schemas/valuation-discount.ts
//
// Kept apart from ./common (which re-exports it) because common.ts loads
// next/server for parseBody: the Solver's mutation schema needs this bound
// without pulling Next into the framework-free what-if layer.
import { z } from "zod";

/**
 * Lack-of-marketability / lack-of-control valuation discount on a gift, as a
 * FRACTION (0.3 = 30%). Null or absent means "no discount", which behaves
 * identically to 0. Shared by `gifts` and `gift_series` — both store it in a
 * `numeric(6,4)` column guarded by `CHECK (d IS NULL OR (d >= 0 AND d < 1))`.
 *
 * Why the upper bound is 0.99995 and not 1: Postgres coerces the value to
 * `numeric(6,4)` — rounding half AWAY FROM ZERO at 4 decimal places — BEFORE it
 * evaluates the CHECK. So 0.99995 is stored as 1.0000 and then trips the CHECK.
 * A bound of `.lt(1)` would let the whole window [0.99995, 1) through Zod and
 * turn a should-have-been-400 into a 500 at the database. 0.9999 is the largest
 * discount `numeric(6,4)` can hold below 1, so the last value that survives the
 * round trip is anything strictly under 0.99995. (The sibling `percent` column
 * has no equivalent hole because its bound is `lte(1)`, which tolerates the
 * rounding.) Keep this in step with the table CHECK in `src/db/schema.ts`.
 */
export const valuationDiscount = z.number().gte(0).lt(0.99995).optional().nullable();
