export const TRUST_SUB_TYPES = [
  "irrevocable",
  "ilit",
  "clt",
  "idgt",
  "crt",
] as const;
export type TrustSubType = (typeof TRUST_SUB_TYPES)[number];

export function deriveIsIrrevocable(_subType: TrustSubType): boolean {
  return true; // every remaining trust subtype is irrevocable
}
