import { z } from "zod";

// Mirrors `AsOfSelection` in src/lib/estate/transfer-report.ts so the estate
// builders accept it directly. "today"/"split" need no extra fields; "year"
// carries an explicit calendar year.
export const estateAsOfSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("today") }),
  z.object({ kind: z.literal("split") }),
  z.object({ kind: z.literal("year"), year: z.number().int() }),
]);

export const estateOptionsSchema = z.object({
  asOf: estateAsOfSchema,
  showHeirDetail: z.boolean(),
  ordering: z.enum(["primaryFirst", "spouseFirst"]).default("primaryFirst"),
});

export type EstatePageOptions = z.infer<typeof estateOptionsSchema>;

export const ESTATE_PAGE_OPTIONS_DEFAULT: EstatePageOptions = {
  asOf: { kind: "split" },
  showHeirDetail: true,
  ordering: "primaryFirst",
};
