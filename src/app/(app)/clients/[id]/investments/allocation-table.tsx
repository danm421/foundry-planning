"use client";

import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";

interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number }[];
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export default function AllocationTable({ household, benchmarkWeights, assetClasses }: Props) {
  const currentById = new Map(household.byAssetClass.map((b) => [b.id, b.pctOfClassified]));
  const targetById = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const ids = new Set<string>([...currentById.keys(), ...targetById.keys()]);

  const rows = Array.from(ids)
    .map((id) => {
      const ac = assetClasses.find((c) => c.id === id);
      return {
        id,
        name: ac?.name ?? id,
        sortOrder: ac?.sortOrder ?? 0,
        current: currentById.get(id) ?? 0,
        target: targetById.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 font-medium">Current</th>
            <th className="px-2 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = colorForAssetClass({ sortOrder: r.sortOrder });
            return (
              <tr key={r.id} className="border-b border-gray-900">
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {r.name}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
                      <div className="h-full" style={{ width: `${Math.min(r.current * 100, 100)}%`, backgroundColor: color }} />
                    </div>
                    <span className="tabular-nums">{pct(r.current)}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
                      <div className="h-full" style={{ width: `${Math.min(r.target * 100, 100)}%`, backgroundColor: color }} />
                    </div>
                    <span className="tabular-nums">{pct(r.target)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
          {household.unallocatedValue > 0 && (
            <tr className="italic text-gray-500">
              <td className="px-2 py-2">
                <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: UNALLOCATED_COLOR }} />
                Unallocated
              </td>
              <td className="px-2 py-2">—</td>
              <td className="px-2 py-2">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
