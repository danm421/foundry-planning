import type { DonutSpec, DonutSegment } from "./types";
import {
  colorForAssetClass,
  colorForAssetType,
  shadeForClassInType,
  UNALLOCATED_COLOR,
} from "@/lib/investments/palette";
import type { AssetTypeId } from "@/lib/investments/asset-types";

/** Minimal allocation shape the donut builder consumes. Both a group's
 *  HouseholdAllocation and a portfolio-derived NormalizedAllocation satisfy it.
 *  `value` is a proportional magnitude — dollars for a group, weights for a
 *  portfolio. Only the ratio between entries is meaningful; never read it as a
 *  dollar amount. */
export interface AllocationDonutInput {
  byAssetClass: { id: string; name: string; sortOrder: number; value: number; assetType: AssetTypeId }[];
  byAssetType: { id: AssetTypeId; label: string; value: number }[];
  unallocatedValue: number;
}

export type DonutView = "high_level" | "detailed" | "combined";

/** Proportional [start,end] angles (radians, clockwise from 12 o'clock). */
export function segmentAngles(values: number[]): { start: number; end: number }[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return [];
  const out: { start: number; end: number }[] = [];
  let acc = 0;
  for (const v of values) {
    const start = (acc / total) * Math.PI * 2;
    acc += Math.max(0, v);
    out.push({ start, end: (acc / total) * Math.PI * 2 });
  }
  return out;
}

/** SVG donut-segment path. Angles measured clockwise from 12 o'clock. */
export function donutArcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  start: number,
  end: number,
): string {
  const pt = (r: number, a: number) =>
    [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  const large = end - start > Math.PI ? 1 : 0;
  const [ox1, oy1] = pt(rOuter, start);
  const [ox2, oy2] = pt(rOuter, end);
  const [ix2, iy2] = pt(rInner, end);
  const [ix1, iy1] = pt(rInner, start);
  return [
    `M ${ox1} ${oy1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1}`,
    "Z",
  ].join(" ");
}

function withFractions(segs: Omit<DonutSegment, "fraction">[]): DonutSegment[] {
  const total = segs.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return segs.map((s) => ({ ...s, fraction: Math.max(0, s.value) / total }));
}

const SIZE = 150;

export function buildAllocationDonutSpec(h: AllocationDonutInput, view: DonutView): DonutSpec {
  const unalloc: Omit<DonutSegment, "fraction">[] =
    h.unallocatedValue > 0
      ? [{ key: "__unallocated__", label: "Unallocated", value: h.unallocatedValue, color: UNALLOCATED_COLOR }]
      : [];

  const typeSegs = withFractions([
    ...h.byAssetType.map((t) => ({
      key: t.id,
      label: t.label,
      value: t.value,
      color: colorForAssetType(t.id as AssetTypeId),
    })),
    ...unalloc,
  ]);

  // For combined view: shade each class within its type using per-type index.
  // shadeForClassInType(typeId, index, totalClassesInType) — 3-arg form.
  const classSegs: DonutSegment[] = (() => {
    const raw = h.byAssetClass;

    if (view === "combined") {
      // Count how many classes share each type (denominator for shading).
      const countByType = new Map<string, number>();
      for (const c of raw) {
        countByType.set(c.assetType, (countByType.get(c.assetType) ?? 0) + 1);
      }
      // Track per-type index as we iterate.
      const indexByType = new Map<string, number>();

      const base: Omit<DonutSegment, "fraction">[] = raw.map((c) => {
        const total = countByType.get(c.assetType) ?? 1;
        const idx = indexByType.get(c.assetType) ?? 0;
        indexByType.set(c.assetType, idx + 1);
        return {
          key: c.id,
          label: c.name,
          value: c.value,
          color: shadeForClassInType(c.assetType as AssetTypeId, idx, total),
        };
      });
      return withFractions([...base, ...unalloc]);
    }

    // detailed or high_level: use palette by sortOrder
    return withFractions([
      ...raw.map((c) => ({
        key: c.id,
        label: c.name,
        value: c.value,
        color: colorForAssetClass({ sortOrder: c.sortOrder }),
      })),
      ...unalloc,
    ]);
  })();

  const rings =
    view === "high_level"
      ? [{ segments: typeSegs }]
      : view === "detailed"
        ? [{ segments: classSegs }]
        : [{ segments: typeSegs }, { segments: classSegs }];

  const legendSource = view === "high_level" ? typeSegs : classSegs;

  return {
    kind: "donut",
    size: SIZE,
    rings,
    legend: legendSource.map((s) => ({ label: s.label, color: s.color, pct: s.fraction })),
  };
}

