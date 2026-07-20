// Pure allocation vocabulary + rules for the divorce workbench. Shared by the
// UI, the commit preview, and the commit engine so the three can never
// disagree about what a default is or what's allowed. No DB imports.

export const DIVORCE_TARGET_KINDS = [
  "account", "income", "expense", "liability",
  "entity", "note_receivable", "family_member",
] as const;

export type DivorceTargetKind = (typeof DIVORCE_TARGET_KINDS)[number];

export type DivorceDisposition = "primary" | "spouse" | "split" | "duplicate";
export type OwnerSide = "primary" | "spouse" | "joint" | "entity" | "external" | "none";

export interface DivisibleObject {
  kind: DivorceTargetKind;
  id: string;
  label: string;
  subtype: string | null;        // accounts.category, incomes.type, entities.entityType/trustSubType…
  value: number;                 // balance-sheet value (liabilities positive, subtracted in totals)
  basis: number;
  rothValue: number;
  annualAmount: number;          // incomes/expenses; 0 otherwise
  ownerSide: OwnerSide;
  entityOwnedById: string | null; // non-null ⇒ NOT in the pool; follows its entity
  childIds: string[];            // entity → owned account ids (render nested, move as a unit)
}

export interface ResolvedAllocation {
  disposition: DivorceDisposition;
  splitPercentToSpouse: number | null;
  isDefault: boolean;            // true when no allocation row exists yet
  needsDecision: boolean;        // joint default not yet confirmed → blocks commit
}

export class AllocationError extends Error {
  code: "invalid_disposition" | "invalid_split" | "not_allocatable";
  constructor(code: AllocationError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "AllocationError";
  }
}

const SPLITTABLE_ACCOUNT_CATEGORIES = new Set([
  "taxable", "cash", "retirement", "annuity", "real_estate",
]);

export function isSplittable(obj: DivisibleObject): boolean {
  return obj.kind === "account" && obj.subtype != null &&
    SPLITTABLE_ACCOUNT_CATEGORIES.has(obj.subtype);
}

export function allowedDispositions(obj: DivisibleObject): DivorceDisposition[] {
  if (obj.kind === "entity" || obj.kind === "family_member") {
    return ["primary", "spouse", "duplicate"];
  }
  if (isSplittable(obj)) return ["primary", "spouse", "split"];
  return ["primary", "spouse"];
}

export function defaultDisposition(
  obj: DivisibleObject,
): { disposition: DivorceDisposition; needsDecision: boolean } {
  if (obj.kind === "family_member") return { disposition: "duplicate", needsDecision: false };
  if (obj.kind === "entity") {
    if (obj.ownerSide === "primary" || obj.ownerSide === "spouse") {
      return { disposition: obj.ownerSide, needsDecision: false };
    }
    return { disposition: "duplicate", needsDecision: false };
  }
  // 529s follow the custodial side; whole-assign, never a commit blocker.
  if (obj.kind === "account" && obj.subtype === "education_savings") {
    return { disposition: obj.ownerSide === "spouse" ? "spouse" : "primary", needsDecision: false };
  }
  if (obj.ownerSide === "primary" || obj.ownerSide === "spouse") {
    return { disposition: obj.ownerSide, needsDecision: false };
  }
  // joint / external / none → parked on primary until the advisor decides.
  return { disposition: "primary", needsDecision: true };
}

export function validateAllocation(
  obj: DivisibleObject,
  disposition: DivorceDisposition,
  splitPercentToSpouse: number | null,
): void {
  if (obj.entityOwnedById) {
    throw new AllocationError("not_allocatable", `${obj.kind} ${obj.id} follows its entity`);
  }
  if (!allowedDispositions(obj).includes(disposition)) {
    throw new AllocationError("invalid_disposition", `${disposition} not allowed for ${obj.kind}/${obj.subtype}`);
  }
  if (disposition === "split") {
    if (splitPercentToSpouse == null || splitPercentToSpouse <= 0 || splitPercentToSpouse >= 100) {
      throw new AllocationError("invalid_split", "split requires 0 < percent < 100");
    }
  } else if (splitPercentToSpouse != null) {
    throw new AllocationError("invalid_split", "percent only valid with split");
  }
}

export function allocationKey(kind: DivorceTargetKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * The destination side(s) a resolved disposition lands its ORIGINAL row on.
 * `spouse` → spouse; `duplicate` → BOTH (the row is deep-copied to S while the
 * original stays on P); `primary` and `split` both keep the original id on the
 * primary's book (a split UPDATEs the original in place on P and INSERTs a fresh
 * id for the spouse share). Undefined (no allocation) → no side. The single pure
 * mapping shared by the preview's link-straddle detection, the commit engine's
 * follow-or-drop, and side-totals — so all three can never disagree.
 */
export function dispositionSides(
  disposition: DivorceDisposition | undefined,
): Array<"primary" | "spouse"> {
  if (!disposition) return [];
  if (disposition === "spouse") return ["spouse"];
  if (disposition === "duplicate") return ["primary", "spouse"];
  return ["primary"]; // primary + split both keep the original id on P
}

export function resolveAllocations(
  objects: DivisibleObject[],
  rows: Array<{ targetKind: string; targetId: string; disposition: DivorceDisposition; splitPercentToSpouse: string | null }>,
): Map<string, ResolvedAllocation> {
  const byKey = new Map(rows.map((r) => [`${r.targetKind}:${r.targetId}`, r]));
  const out = new Map<string, ResolvedAllocation>();
  for (const obj of objects) {
    if (obj.entityOwnedById) continue; // follows its entity — not independently allocatable
    const key = allocationKey(obj.kind, obj.id);
    const row = byKey.get(key);
    if (row) {
      out.set(key, {
        disposition: row.disposition,
        splitPercentToSpouse: row.splitPercentToSpouse == null ? null : Number(row.splitPercentToSpouse),
        isDefault: false,
        needsDecision: false,
      });
    } else {
      const d = defaultDisposition(obj);
      out.set(key, {
        disposition: d.disposition,
        splitPercentToSpouse: null,
        isDefault: true,
        needsDecision: d.needsDecision,
      });
    }
  }
  return out;
}

/** Count objects still awaiting an allocation decision — the single source for
 *  the board's "N decisions remaining" counter AND the workbench commit CTA gate
 *  so the two can never disagree. resolveAllocations already omits entity-owned
 *  children, so counting `needsDecision` over the resolved values is exact. */
export function countDecisionsRemaining(resolved: Map<string, ResolvedAllocation>): number {
  let n = 0;
  for (const a of resolved.values()) if (a.needsDecision) n += 1;
  return n;
}
