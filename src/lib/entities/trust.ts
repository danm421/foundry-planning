export const TRUST_SUB_TYPES = [
  "revocable",
  "irrevocable",
  "ilit",
  "slat",
  "crt",
  "grat",
  "qprt",
  "clat",
  "qtip",
  "bypass",
] as const;
export type TrustSubType = (typeof TRUST_SUB_TYPES)[number];

export const REVOCABLE_SUB_TYPES: ReadonlySet<TrustSubType> = new Set([
  "revocable",
]);

export function deriveIsIrrevocable(subType: TrustSubType): boolean {
  return !REVOCABLE_SUB_TYPES.has(subType);
}
