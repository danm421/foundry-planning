"use client";

import { z } from "zod";
import { AssetAllocationComparisonSection } from "@/components/comparison/asset-allocation-comparison-section";
import type { ComparisonWidgetDefinition, ComparisonWidgetConfigContext } from "./types";

const AssetAllocationConfigSchema = z.object({
  mode: z.enum(["high_level", "detailed", "combined"]),
});
type AssetAllocationConfig = z.infer<typeof AssetAllocationConfigSchema>;
const defaultAssetAllocationConfig: AssetAllocationConfig = { mode: "detailed" };

function getMode(config: unknown): AssetAllocationConfig["mode"] {
  const parsed = AssetAllocationConfigSchema.safeParse(config);
  return parsed.success ? parsed.data.mode : "detailed";
}

const MODE_BUTTONS: Array<{ value: AssetAllocationConfig["mode"]; label: string }> = [
  { value: "high_level", label: "Grouped" },
  { value: "detailed", label: "Detailed" },
  { value: "combined", label: "Combined" },
];

function renderConfig(ctx: ComparisonWidgetConfigContext<AssetAllocationConfig>) {
  const current = getMode(ctx.config);
  return (
    <div role="radiogroup" aria-label="Allocation mode" className="flex gap-1">
      {MODE_BUTTONS.map((b) => {
        const active = current === b.value;
        return (
          <button
            key={b.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => ctx.onChange({ mode: b.value })}
            className={`rounded border px-2 py-1 text-xs ${
              active ? "border-amber-400 bg-amber-400/10 text-amber-200" : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

export const assetAllocationWidget: ComparisonWidgetDefinition<AssetAllocationConfig> = {
  kind: "asset-allocation",
  title: "Asset Allocation",
  category: "investments",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: AssetAllocationConfigSchema,
  defaultConfig: defaultAssetAllocationConfig,
  renderConfig,
  render: ({ plans, config }) => (
    <AssetAllocationComparisonSection plans={plans} mode={getMode(config)} />
  ),
};
