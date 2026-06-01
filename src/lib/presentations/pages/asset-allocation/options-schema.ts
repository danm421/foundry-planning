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
});
export type AssetAllocationOptions = z.infer<typeof baseSchema>;

export const ASSET_ALLOCATION_OPTIONS_DEFAULT: AssetAllocationOptions = {
  left: { kind: "group", id: "all-liquid" },
  right: { kind: "recommended" },
  view: "detailed",
  includeOutOfEstate: false,
  showTable: true,
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
