import { z } from "zod";

export const sourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), id: z.string() }),
  z.object({ kind: z.literal("portfolio"), id: z.string() }),
  z.object({ kind: z.literal("recommended") }),
]);
export type SourceRef = z.infer<typeof sourceRefSchema>;

const baseSchema = z.object({
  left: sourceRefSchema,
  right: sourceRefSchema.nullable(),
  view: z.enum(["high_level", "detailed", "combined"]),
  includeOutOfEstate: z.boolean(),
  showTable: z.boolean(),
  // Itemize investable accounts that have no asset mix below the donuts.
  // Defaulted so option blobs saved before this field still parse.
  showExcluded: z.boolean().default(true),
  // Print each side's blended expected return under its donut. Defaults OFF —
  // it is a forward-looking figure, so it only appears in a deck the advisor
  // explicitly turned it on for, never retroactively in an already-saved one.
  showReturn: z.boolean().default(false),
});
export type AssetAllocationOptions = z.infer<typeof baseSchema>;

export const ASSET_ALLOCATION_OPTIONS_DEFAULT: AssetAllocationOptions = {
  left: { kind: "group", id: "all-liquid" },
  right: { kind: "recommended" },
  view: "detailed",
  includeOutOfEstate: false,
  showTable: true,
  showExcluded: true,
  showReturn: false,
};

/**
 * Migrate the pre-comparison options shape ({ groupKey, view, ... }) to the new
 * left/right shape. Anything that already has a `left` field passes through.
 */
function migrateRawOptions(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !("left" in raw) && "groupKey" in raw) {
    const o = raw as Record<string, unknown>;
    return {
      left: { kind: "group", id: typeof o.groupKey === "string" ? o.groupKey : "all-liquid" },
      right: { kind: "recommended" },
      view: o.view ?? "detailed",
      includeOutOfEstate: o.includeOutOfEstate ?? false,
      showTable: o.showTable ?? true,
      showExcluded: o.showExcluded ?? true,
      showReturn: o.showReturn ?? false,
    };
  }
  return raw;
}

export const assetAllocationOptionsSchema = z.preprocess(migrateRawOptions, baseSchema);

/**
 * Best-effort normalize for the builder UI / preview: migrate legacy blobs,
 * fill missing fields from the default, and never throw (falls back to default).
 */
export function normalizeAssetAllocationOptions(raw: unknown): AssetAllocationOptions {
  const migrated = migrateRawOptions(raw);
  const merged = {
    ...ASSET_ALLOCATION_OPTIONS_DEFAULT,
    ...(migrated && typeof migrated === "object" ? (migrated as object) : {}),
  };
  const parsed = baseSchema.safeParse(merged);
  return parsed.success ? parsed.data : ASSET_ALLOCATION_OPTIONS_DEFAULT;
}
