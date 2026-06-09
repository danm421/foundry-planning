import type { TrustEnds } from "./trust-ends-select";

export interface RevocableEntityBodyInput {
  name: string;
  grantor: "client" | "spouse";
  notes?: string | null;
}

/**
 * Build the `/entities` POST/PUT body for a revocable trust. A revocable trust
 * does nothing in the projection except keep its assets in the household
 * portfolio + gross estate while letting them avoid probate, so every
 * behavioral field (distribution policy, grantor-tax status, provisions) is
 * forced off. `trustEnds` follows the grantor's death so the trust resolves to
 * its remainder beneficiaries at the correct death event.
 *
 * Shape mirrors the `entityBody` object in add-trust-form.tsx's saveAsyncImpl.
 */
export function buildRevocableEntityBody(input: RevocableEntityBodyInput) {
  const trustEnds: TrustEnds = input.grantor === "spouse" ? "spouse_death" : "client_death";
  return {
    name: input.name,
    entityType: "trust" as const,
    notes: input.notes ?? null,
    includeInPortfolio: true, // revocable-trust assets pass through to the household portfolio
    accessibleToClient: false,
    crummeyPowers: false,
    isGrantor: false,
    grantorStatusEndYear: null,
    value: "0",
    owner: null,
    grantor: input.grantor,
    beneficiaries: [] as never[], // legacy JSON column kept empty
    trustSubType: "revocable" as const,
    isIrrevocable: false,
    trustee: null,
    trustEnds,
    distributionMode: null,
    distributionAmount: null,
    distributionPercent: null,
  };
}
