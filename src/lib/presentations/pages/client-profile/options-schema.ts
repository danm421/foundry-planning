import { z } from "zod";
import {
  CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT,
  MAX_EXPENSE_COLUMNS,
  MAX_YEARS_FROM_NOW,
  type ClientProfilePageOptions,
} from "./types";

const expenseColumnSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }),
  z.object({ kind: z.literal("retirement") }),
  z.object({ kind: z.literal("yearsFromNow"), years: z.number().int().min(1).max(MAX_YEARS_FROM_NOW) }),
]);

// Defaulted so decks and templates saved before the option existed (`{}`)
// keep printing Current vs. Retirement.
export const clientProfileOptionsSchema = z.object({
  expenseColumns: z
    .array(expenseColumnSchema)
    .min(1)
    .max(MAX_EXPENSE_COLUMNS)
    .default(CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT.expenseColumns),
}) satisfies z.ZodType<ClientProfilePageOptions>;

/** The launcher hands the summary and the options control the deck's RAW page
 *  options, which for a deck saved before this option existed is `{}`. Parse at
 *  the read site, falling back to the default for a foreign blob. */
export function resolveClientProfileOptions(raw: unknown): ClientProfilePageOptions {
  const parsed = clientProfileOptionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT;
}
