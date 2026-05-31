import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from "./cma-seed";
import cmaDefaults from "./cma-defaults.generated.json";

// DB column scales — round both sides to these before comparing so numeric→string
// round-trips and float noise never manufacture a phantom diff.
const VALUE_SCALE = 4; // geometric_return / arithmetic_mean / volatility / pct_* are decimal(_,4)
const CORRELATION_SCALE = 5; // asset_class_correlations.correlation is decimal(6,5)

const GENERATED_AT: string = cmaDefaults.meta.generatedAt;

// Numeric value fields a refresh can update. assetType is compared separately
// (string). name / slug / sortOrder are never refreshed.
export const NUMERIC_VALUE_FIELDS = [
  "geometricReturn",
  "arithmeticMean",
  "volatility",
  "pctOrdinaryIncome",
  "pctLtCapitalGains",
  "pctQualifiedDividends",
  "pctTaxExempt",
] as const;

export type NumericValueField = (typeof NUMERIC_VALUE_FIELDS)[number];

export interface ExistingValueClass {
  id: string;
  name: string;
  geometricReturn: string;
  arithmeticMean: string;
  volatility: string;
  pctOrdinaryIncome: string;
  pctLtCapitalGains: string;
  pctQualifiedDividends: string;
  pctTaxExempt: string;
  assetType: string;
}

export interface ExistingCorrelation {
  idA: string;
  idB: string;
  correlation: number | string;
}

export interface FieldChange {
  field: NumericValueField | "assetType";
  current: string;
  next: string;
}

export interface ClassValueDiff {
  id: string;
  name: string;
  changes: FieldChange[];
}

export interface ValueRefreshPreview {
  generatedAt: string;
  classChanges: ClassValueDiff[];
  missingStandardClasses: string[];
  correlationPairsToRefresh: number;
}

export interface ValueRefreshRequest {
  classIds: string[];
  refreshCorrelations: boolean;
}

const STANDARD_BY_NAME = new Map(DEFAULT_ASSET_CLASSES.map((ac) => [ac.name, ac]));

function sameNumber(stored: string, def: number, scale: number): boolean {
  const s = Number(stored);
  if (!Number.isFinite(s)) return false;
  return s.toFixed(scale) === def.toFixed(scale);
}

function canonicalKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Pure. Inputs are DB rows; output drives the refresh dialog. */
export function buildValueRefreshPreview(
  existingClasses: ExistingValueClass[],
  existingCorrelations: ExistingCorrelation[],
): ValueRefreshPreview {
  const existingNames = new Set(existingClasses.map((c) => c.name));

  // 1. Per name-matched standard class: collect changed value fields.
  const classChanges: ClassValueDiff[] = [];
  for (const ec of existingClasses) {
    const def = STANDARD_BY_NAME.get(ec.name);
    if (!def) continue; // legacy / custom class — never touched
    const changes: FieldChange[] = [];
    for (const field of NUMERIC_VALUE_FIELDS) {
      if (!sameNumber(ec[field], def[field], VALUE_SCALE)) {
        changes.push({ field, current: ec[field], next: String(def[field]) });
      }
    }
    if (ec.assetType !== def.assetType) {
      changes.push({ field: "assetType", current: ec.assetType, next: def.assetType });
    }
    if (changes.length > 0) classChanges.push({ id: ec.id, name: ec.name, changes });
  }

  // 2. Standard classes the firm doesn't have (informational only — structural).
  const missingStandardClasses = DEFAULT_ASSET_CLASSES.map((ac) => ac.name).filter(
    (name) => !existingNames.has(name),
  );

  // 3. Standard↔standard correlation pairs that differ or are missing.
  const nameToId = new Map(existingClasses.map((c) => [c.name, c.id]));
  const storedByKey = new Map(
    existingCorrelations.map((c) => [canonicalKey(c.idA, c.idB), c.correlation]),
  );
  let correlationPairsToRefresh = 0;
  for (const dc of DEFAULT_CORRELATIONS) {
    const a = nameToId.get(dc.classA);
    const b = nameToId.get(dc.classB);
    if (!a || !b) continue; // a standard class is missing → structural migration's job
    const stored = storedByKey.get(canonicalKey(a, b));
    if (stored === undefined || !sameNumber(String(stored), dc.correlation, CORRELATION_SCALE)) {
      correlationPairsToRefresh++;
    }
  }

  return { generatedAt: GENERATED_AT, classChanges, missingStandardClasses, correlationPairsToRefresh };
}

/** Returns null on success, or an error string suitable for a 400 response. */
export function validateRefreshRequest(
  preview: ValueRefreshPreview,
  req: ValueRefreshRequest,
): string | null {
  const changeable = new Set(preview.classChanges.map((c) => c.id));
  for (const id of req.classIds) {
    if (!changeable.has(id)) return `Class ${id} has no pending standard-value changes`;
  }
  if (req.classIds.length === 0 && !req.refreshCorrelations) {
    return "Nothing selected to refresh";
  }
  return null;
}
