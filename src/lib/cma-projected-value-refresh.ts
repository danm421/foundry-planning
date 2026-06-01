import projected from "@/lib/cma-projected.generated.json";

// DB column scale — round both sides before comparing so numeric→string
// round-trips and float noise never manufacture a phantom diff.
const VALUE_SCALE = 4; // geometric_return / arithmetic_mean / volatility are decimal(_,4)

const GENERATED_AT: string = projected.meta.generatedAt;

// The 3 per-set numeric fields stored in cma_set_values. pct_* and assetType are
// identity columns on asset_classes (owned by the Historical refresh) — never
// touched here. Correlations are firm-level, not per-set, and absent from the file.
export const PROJECTED_NUMERIC_FIELDS = [
  "geometricReturn",
  "arithmeticMean",
  "volatility",
] as const;

export type ProjectedNumericField = (typeof PROJECTED_NUMERIC_FIELDS)[number];

export interface ProjectedGeneratedClass {
  name: string;
  slug?: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
}

export interface ExistingProjectedClass {
  id: string; // asset_class id
  name: string;
  slug: string | null;
  geometricReturn: string;
  arithmeticMean: string;
  volatility: string;
}

export interface ProjectedFieldChange {
  field: ProjectedNumericField;
  current: string;
  next: string;
}

export interface ProjectedClassValueDiff {
  id: string;
  name: string;
  changes: ProjectedFieldChange[];
}

export interface ProjectedValueRefreshPreview {
  generatedAt: string;
  classChanges: ProjectedClassValueDiff[];
}

export interface ProjectedValueRefreshRequest {
  classIds: string[];
}

const BY_SLUG = new Map<string, ProjectedGeneratedClass>();
const BY_NAME = new Map<string, ProjectedGeneratedClass>();
for (const c of projected.assetClasses as ProjectedGeneratedClass[]) {
  if (c.slug) BY_SLUG.set(c.slug, c);
  BY_NAME.set(c.name, c);
}

/** Resolve a firm class to its generated counterpart by slug, then name —
 *  the same precedence seedCmaSetsForFirm uses. */
export function resolveProjectedClass(
  name: string,
  slug: string | null,
): ProjectedGeneratedClass | undefined {
  return (slug ? BY_SLUG.get(slug) : undefined) ?? BY_NAME.get(name);
}

function sameNumber(stored: string, def: number, scale: number): boolean {
  const s = Number(stored);
  if (!Number.isFinite(s)) return false;
  return s.toFixed(scale) === def.toFixed(scale);
}

/** Pure. Input is the firm's projected cma_set_values (joined to name/slug);
 *  output drives the projected-refresh dialog. */
export function buildProjectedValueRefreshPreview(
  existing: ExistingProjectedClass[],
): ProjectedValueRefreshPreview {
  const classChanges: ProjectedClassValueDiff[] = [];
  for (const ec of existing) {
    const gen = resolveProjectedClass(ec.name, ec.slug);
    if (!gen) continue; // legacy / unmapped class — never touched
    const changes: ProjectedFieldChange[] = [];
    for (const field of PROJECTED_NUMERIC_FIELDS) {
      if (!sameNumber(ec[field], gen[field], VALUE_SCALE)) {
        changes.push({ field, current: ec[field], next: String(gen[field]) });
      }
    }
    if (changes.length > 0) classChanges.push({ id: ec.id, name: ec.name, changes });
  }
  return { generatedAt: GENERATED_AT, classChanges };
}

/** Returns null on success, or an error string suitable for a 400 response. */
export function validateProjectedRefreshRequest(
  preview: ProjectedValueRefreshPreview,
  req: ProjectedValueRefreshRequest,
): string | null {
  const changeable = new Set(preview.classChanges.map((c) => c.id));
  for (const id of req.classIds) {
    if (!changeable.has(id)) return `Class ${id} has no pending projected-value changes`;
  }
  if (req.classIds.length === 0) return "Nothing selected to refresh";
  return null;
}
