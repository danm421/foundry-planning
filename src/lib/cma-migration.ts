import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from "./cma-seed";

// All standard names — INCLUDING Inflation. The migration inserts any of
// these that the firm is missing (Inflation included, so opted-in firms get
// the engine-required class even if they were seeded before it existed).
const STANDARD_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_ASSET_CLASSES.map((ac) => ac.name)
);

// Names that are valid as remap *targets*. Inflation is engine-only and not a
// sensible target for advisor allocations — exclude it from the dropdown.
const REMAP_TARGET_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_ASSET_CLASSES.filter((ac) => ac.slug !== "inflation").map(
    (ac) => ac.name
  )
);

/** Best-fit standard target for each legacy class name. Used as the
 *  default selection in the migration dialog so advisors don't have to
 *  pick anything for the common cases. */
const SUGGESTED_REMAP: Record<string, string> = {
  // ── Renames ────────────────────────────────────────────────────────────
  "Int'l Developed":        "Global ex-US Stock Market",
  "REITs":                  "REIT",
  "Precious Metals":        "Gold",
  "High Yield Bond":        "High Yield Corporate Bonds",
  // ── Restructures ───────────────────────────────────────────────────────
  // Aggregate IG bond → 10-year Treasury (closest in duration / risk profile
  // among the standard options; the standard set has no broad-IG aggregate).
  "US Aggregate Bond":      "10-year Treasury",
  // Investment-grade corporates → 10-year Treasury (HY would be too risky a
  // remap; advisors who specifically held credit risk can override).
  "US Corporate Bond":      "10-year Treasury",
  // Munis → the only tax-exempt bond in the standard set.
  "US Municipal Bond":      "Intermediate-Term Tax-Exempt",
  // Cash → shortest available Treasury (closest in duration & risk).
  "Cash / Money Market":    "Short Term Treasury",
};

export interface ExistingClass {
  id: string;
  name: string;
}

export interface ExistingCorrelationPair {
  idA: string;
  idB: string;
}

export interface RemovedClassPreview {
  id: string;
  name: string;
  /** Number of `account_asset_allocations` rows pointing at this class. */
  accountAllocCount: number;
  /** Number of `model_portfolio_allocations` rows pointing at this class. */
  portfolioAllocCount: number;
  /** Best-fit standard class name to default the remap dropdown to. Null when
   *  there's no obvious mapping (e.g. an advisor's custom class). */
  suggestedTargetName: string | null;
}

export interface AssetClassesPreview {
  /** Standard classes the firm doesn't have yet (by name). */
  added: { name: string }[];
  /** Firm classes that aren't in the standard set; show usage counts so the
   *  advisor can decide remap vs. keep vs. delete. */
  removed: RemovedClassPreview[];
  /** Firm classes whose name matches a standard class — no action. */
  unchanged: { id: string; name: string }[];
}

export interface MigrationPreview {
  assetClasses: AssetClassesPreview;
  /** Standard pairs that aren't already present in the firm (we never overwrite). */
  correlationPairsToAdd: number;
  /** Every name a remap can target (existing + about-to-be-added), excluding
   *  Inflation. The dialog populates dropdowns from this. */
  allTargetNames: { name: string; alreadyInFirm: boolean }[];
}

/** Pure helper. Inputs come from DB queries; output drives the preview UI. */
export function buildMigrationPreview(
  existingClasses: ExistingClass[],
  existingCorrelations: ExistingCorrelationPair[],
  referenceCounts: Map<string, { accounts: number; portfolios: number }>
): MigrationPreview {
  const existingNames = new Set(existingClasses.map((c) => c.name));

  const added = [...STANDARD_NAMES]
    .filter((name) => !existingNames.has(name))
    .map((name) => ({ name }));

  const removed: RemovedClassPreview[] = existingClasses
    .filter((c) => !STANDARD_NAMES.has(c.name))
    .map((c) => {
      const counts = referenceCounts.get(c.id) ?? { accounts: 0, portfolios: 0 };
      const suggested = SUGGESTED_REMAP[c.name] ?? null;
      return {
        id: c.id,
        name: c.name,
        accountAllocCount: counts.accounts,
        portfolioAllocCount: counts.portfolios,
        suggestedTargetName: suggested,
      };
    });

  const unchanged = existingClasses
    .filter((c) => STANDARD_NAMES.has(c.name))
    .map((c) => ({ id: c.id, name: c.name }));

  // Map standard names → existing class IDs (only meaningful once they're seeded).
  const nameToId = new Map(existingClasses.map((c) => [c.name, c.id]));
  const haveCorrelation = new Set(
    existingCorrelations.map(({ idA, idB }) => canonicalKey(idA, idB))
  );
  let correlationPairsToAdd = 0;
  for (const c of DEFAULT_CORRELATIONS) {
    const a = nameToId.get(c.classA);
    const b = nameToId.get(c.classB);
    // Pairs where one side hasn't been seeded yet *will* be added as part of
    // the migration (we insert missing classes first), so count them too.
    if (!a && !STANDARD_NAMES.has(c.classA)) continue;
    if (!b && !STANDARD_NAMES.has(c.classB)) continue;
    if (a && b && haveCorrelation.has(canonicalKey(a, b))) continue;
    correlationPairsToAdd++;
  }

  // Targets: every name that will exist post-migration except Inflation.
  // Stable sort by name so the dropdown is alphabetical.
  const allTargetNames = [...REMAP_TARGET_NAMES]
    .map((name) => ({ name, alreadyInFirm: existingNames.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    assetClasses: { added, removed, unchanged },
    correlationPairsToAdd,
    allTargetNames,
  };
}

function canonicalKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type Remapping =
  | { kind: "remap"; toClassName: string }
  | { kind: "keep" }
  | { kind: "delete" };

export interface MigrationRequest {
  /** Keyed by old (removed) asset class ID. */
  remappings: Record<string, Remapping>;
}

/** Validate a migration request against a preview. Returns null on success or
 *  an error string suitable for a 400 response. */
export function validateMigrationRequest(
  preview: MigrationPreview,
  req: MigrationRequest
): string | null {
  const removedIds = new Set(preview.assetClasses.removed.map((r) => r.id));
  const validTargetNames = new Set(preview.allTargetNames.map((t) => t.name));
  const removedNamesById = new Map(
    preview.assetClasses.removed.map((r) => [r.id, r.name])
  );

  for (const removed of preview.assetClasses.removed) {
    const r = req.remappings[removed.id];
    if (!r) return `Missing remapping for "${removed.name}"`;
    if (r.kind === "remap") {
      if (!validTargetNames.has(r.toClassName)) {
        return `Invalid remap target "${r.toClassName}" for "${removed.name}"`;
      }
      // Self-remap is impossible by construction: a removed name (legacy) is
      // never in the standard target set, so `validTargetNames.has(removed.name)`
      // is always false. No explicit check needed.
    }
    if (
      r.kind === "delete" &&
      (removed.accountAllocCount > 0 || removed.portfolioAllocCount > 0)
    ) {
      return `Cannot delete "${removed.name}" — it is in use; remap or keep instead`;
    }
  }
  for (const id of Object.keys(req.remappings)) {
    if (!removedIds.has(id)) {
      const name = removedNamesById.get(id) ?? id;
      return `Unexpected remapping for class ${name}`;
    }
  }
  return null;
}
