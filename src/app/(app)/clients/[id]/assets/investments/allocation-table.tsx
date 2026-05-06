"use client";

import { Fragment } from "react";
import {
  colorForAssetClass,
  colorForAssetType,
  shadeForClassInType,
  UNALLOCATED_COLOR,
} from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { AssetTypeId } from "@/lib/investments/asset-types";

type Mode = "high_level" | "detailed" | "combined";

interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number; assetType: AssetTypeId }[];
  onRowClick: (rowId: string) => void;
  mode: Mode;
}

// Type-row drill ids are prefixed so the investments-client can distinguish
// them from class ids and the reserved "__unallocated__" sentinel.
const TYPE_DRILL_PREFIX = "__type__:";

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationTable({
  household, benchmarkWeights, assetClasses, onRowClick, mode,
}: Props) {
  if (mode === "high_level") return <HighLevelTable household={household} benchmarkWeights={benchmarkWeights} onRowClick={onRowClick} />;
  if (mode === "combined")   return <CombinedTable  household={household} benchmarkWeights={benchmarkWeights} onRowClick={onRowClick} />;
  return <DetailedTable household={household} benchmarkWeights={benchmarkWeights} assetClasses={assetClasses} onRowClick={onRowClick} />;
}

// ── High-level: 5 type rows ──────────────────────────────────────────────

function HighLevelTable({
  household, benchmarkWeights, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  onRowClick: (rowId: string) => void;
}) {
  // Compute type-level target by summing class weights of classes in that type.
  const classToType = new Map(household.byAssetClass.map((c) => [c.id, c.assetType]));
  const targetByType = new Map<AssetTypeId, number>();
  for (const w of benchmarkWeights) {
    const tid = classToType.get(w.assetClassId);
    if (!tid) continue; // benchmark class not present in current → ignore for type target
    targetByType.set(tid, (targetByType.get(tid) ?? 0) + w.weight);
  }

  const rows = household.byAssetType;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400">
            <th className="px-2 py-2 font-medium">Asset Type</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 text-right font-medium">Current</th>
            <th className="px-2 py-2 text-right font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const target = targetByType.get(t.id) ?? 0;
            const color = colorForAssetType(t.id);
            return (
              <tr
                key={t.id}
                role="button"
                tabIndex={0}
                aria-label={`Drill into ${t.label}`}
                onClick={() => onRowClick(`${TYPE_DRILL_PREFIX}${t.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(`${TYPE_DRILL_PREFIX}${t.id}`);
                  }
                }}
                className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
              >
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {t.label}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                  {t.value > 0 ? dollars(t.value) : "—"}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={t.pctOfClassified} color={color} />
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={target} color={color} />
                </td>
              </tr>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Detailed: one row per class (the existing view) ─────────────────────

function DetailedTable({
  household, benchmarkWeights, assetClasses, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number; assetType: AssetTypeId }[];
  onRowClick: (rowId: string) => void;
}) {
  const currentById = new Map(household.byAssetClass.map((b) => [b.id, b.pctOfClassified]));
  const valueById = new Map(household.byAssetClass.map((b) => [b.id, b.value]));
  const targetById = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const ids = new Set<string>([...currentById.keys(), ...targetById.keys()]);

  const rows = Array.from(ids)
    .map((id) => {
      const ac = assetClasses.find((c) => c.id === id);
      return {
        id,
        name: ac?.name ?? id,
        sortOrder: ac?.sortOrder ?? 0,
        value: valueById.get(id) ?? 0,
        current: currentById.get(id) ?? 0,
        target: targetById.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 text-right font-medium">Current</th>
            <th className="px-2 py-2 text-right font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = colorForAssetClass({ sortOrder: r.sortOrder });
            return (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={`Drill into ${r.name}`}
                onClick={() => onRowClick(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(r.id);
                  }
                }}
                className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
              >
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {r.name}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                  {r.value > 0 ? dollars(r.value) : "—"}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={r.current} color={color} />
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={r.target} color={color} />
                </td>
              </tr>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Combined: type section headers, class rows nested, non-collapsible ──

function CombinedTable({
  household, benchmarkWeights, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  onRowClick: (rowId: string) => void;
}) {
  const targetByClass = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const classToType = new Map(household.byAssetClass.map((c) => [c.id, c.assetType]));
  const targetByType = new Map<AssetTypeId, number>();
  for (const w of benchmarkWeights) {
    const tid = classToType.get(w.assetClassId);
    if (!tid) continue;
    targetByType.set(tid, (targetByType.get(tid) ?? 0) + w.weight);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 text-right font-medium">Current</th>
            <th className="px-2 py-2 text-right font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {household.byAssetType.map((t) => {
            const classesInType = household.byAssetClass
              .filter((c) => c.assetType === t.id)
              .sort((a, b) => b.value - a.value);
            const typeColor = colorForAssetType(t.id);
            const typeTarget = targetByType.get(t.id) ?? 0;
            return (
              <Fragment key={t.id}>
                <tr className="border-b border-gray-900 bg-gray-800/40 font-semibold">
                  <td className="px-2 py-2 text-gray-100">
                    <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: typeColor }} />
                    {t.label}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-100">{dollars(t.value)}</td>
                  <td className="px-2 py-2 text-gray-100">
                    <BarCell pct={t.pctOfClassified} color={typeColor} />
                  </td>
                  <td className="px-2 py-2 text-gray-100">
                    <BarCell pct={typeTarget} color={typeColor} />
                  </td>
                </tr>
                {classesInType.map((c, idx) => {
                  const color = shadeForClassInType(t.id, idx, classesInType.length);
                  const target = targetByClass.get(c.id) ?? 0;
                  return (
                    <tr
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Drill into ${c.name}`}
                      onClick={() => onRowClick(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(c.id);
                        }
                      }}
                      className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
                    >
                      <td className="px-2 py-2 pl-6 text-gray-200">
                        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                        {c.name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                        {c.value > 0 ? dollars(c.value) : "—"}
                      </td>
                      <td className="px-2 py-2 text-gray-200">
                        <BarCell pct={c.pctOfClassified} color={color} />
                      </td>
                      <td className="px-2 py-2 text-gray-200">
                        <BarCell pct={target} color={color} />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Shared cell helpers ────────────────────────────────────────────────

function BarCell({ pct: p, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
        <div className="h-full" style={{ width: `${Math.min(p * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums">{pct(p)}</span>
    </div>
  );
}

function UnallocatedRow({
  household, onRowClick,
}: {
  household: HouseholdAllocation;
  onRowClick: (rowId: string) => void;
}) {
  if (household.unallocatedValue <= 0) return null;
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label="Drill into Unallocated"
      onClick={() => onRowClick("__unallocated__")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick("__unallocated__");
        }
      }}
      className="cursor-pointer italic text-gray-400 hover:bg-gray-800/60"
    >
      <td className="px-2 py-2">
        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: UNALLOCATED_COLOR }} />
        Unallocated
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{dollars(household.unallocatedValue)}</td>
      <td className="px-2 py-2 text-right">—</td>
      <td className="px-2 py-2 text-right">—</td>
    </tr>
  );
}

export { TYPE_DRILL_PREFIX };
