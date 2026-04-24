import type { BeneficiaryRef, EntitySummary } from "../types";

export interface EntitySuccessionUpdate {
  entityId: string;
  isGrantor?: boolean;
  isIrrevocable?: boolean;
  grantor?: "client" | "spouse" | null;
}

export interface PourOutQueueEntry {
  entityId: string;
  trustBeneficiaries: BeneficiaryRef[];
}

export interface TrustSuccessionResult {
  entityUpdates: EntitySuccessionUpdate[];
  pourOutQueue: PourOutQueueEntry[];
  warnings: string[];
}

/**
 * Compute what entity-level updates the death of `deceased` triggers on
 * their associated trusts. This is compute-only — input entities are NOT
 * mutated. The orchestrator applies the returned entity updates after
 * the gross-estate builder and the creditor/tax drains have all read
 * pre-flip state (see spec's "Pipeline shape" section).
 *
 * Decision tree per entity (see spec Section "Grantor-trust succession"):
 *
 *   skip unless entity.grantor === deceased.
 *   if !isIrrevocable:
 *     revocable trust, sole grantor just died
 *     → update { isGrantor: false, isIrrevocable: true, grantor: null }
 *     → pour-out queued.
 *   elif isIrrevocable && isGrantor:
 *     IDGT where decedent was the income-tax grantor
 *     → update { isGrantor: false, grantor: null }
 *     → warning "idgt_grantor_flipped: <entityId>"; NO pour-out.
 *   else:
 *     irrevocable non-grantor trust (e.g., ILIT where isGrantor was already false)
 *     → skip; already out-of-estate, no further action.
 */
export function applyGrantorSuccession(input: {
  deceased: "client" | "spouse";
  entities: EntitySummary[];
}): TrustSuccessionResult {
  const entityUpdates: EntitySuccessionUpdate[] = [];
  const pourOutQueue: PourOutQueueEntry[] = [];
  const warnings: string[] = [];

  for (const e of input.entities) {
    if (e.grantor !== input.deceased) continue;

    if (!e.isIrrevocable) {
      entityUpdates.push({
        entityId: e.id,
        isGrantor: false,
        isIrrevocable: true,
        grantor: null,
      });
      pourOutQueue.push({
        entityId: e.id,
        trustBeneficiaries: e.beneficiaries ?? [],
      });
    } else if (e.isGrantor) {
      entityUpdates.push({
        entityId: e.id,
        isGrantor: false,
        grantor: null,
      });
      warnings.push(`idgt_grantor_flipped: ${e.id}`);
    }
    // else: irrevocable non-grantor — nothing to do.
  }

  return { entityUpdates, pourOutQueue, warnings };
}
