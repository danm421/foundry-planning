import { z } from "zod";
export const assetAllocationOptionsSchema = z.object({
  groupKey: z.string(),
  view: z.enum(["high_level", "detailed", "combined"]),
  includeOutOfEstate: z.boolean(),
  showTable: z.boolean(),
});
export type AssetAllocationOptions = z.infer<typeof assetAllocationOptionsSchema>;
export const ASSET_ALLOCATION_OPTIONS_DEFAULT: AssetAllocationOptions = {
  groupKey: "all-liquid", view: "detailed", includeOutOfEstate: false, showTable: true,
};
