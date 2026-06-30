import { resolveScheduledColumnForYear } from "../life-insurance-schedule";
import type {
  Account,
  EntitySummary,
  GiftEvent,
  GrossEstateLine,
} from "../types";

export interface Section2035Input {
  /** Household member whose death is being valued. §2035 only applies when
   *  this person was the grantor of the gifted policy. */
  deceased: "client" | "spouse";
  /** Year of death — anchor for the three-year window. */
  deathYear: number;
  /** All gift events fanned out from gift_series + gift rows. Only
   *  `kind === "asset"` events are inspected; cash gifts (Crummey premiums,
   *  outright cash) never trigger §2035. */
  giftEvents: GiftEvent[];
  /** Full account list — used to look up the policy referenced by each
   *  asset-gift event. */
  accounts: Account[];
  /** Full entity list — used to identify which recipient entities are
   *  irrevocable trusts. */
  entities: EntitySummary[];
}

export interface Section2035Output {
  /** Gross-estate lines to APPEND to the deceased's gross estate. Each line
   *  pulls the face value of one life-insurance policy that was gifted to an
   *  irrevocable trust within the three-year window. Scaled by the gift's
   *  `percent` for fractional asset gifts. */
  addBackLines: GrossEstateLine[];
  /** Dollar value to SUBTRACT from the deceased's adjusted taxable gifts,
   *  to avoid double-counting (the gift's reported FMV at gift year).
   *  Callers compute the exact gift value via `accountValueAtYear`
   *  closures; this helper returns the gift's `amountOverride` when set
   *  and otherwise leaves it to the caller (returns 0). */
  giftValueToExclude: number;
}

/**
 * IRC §2035(a) three-year-lookback for life-insurance policies gifted to
 * irrevocable trusts (ILITs).
 *
 * When a grantor gifts a life-insurance policy on their own life to an
 * irrevocable trust and dies within three years of the transfer, the policy's
 * face value is pulled back into the grantor's gross estate. The previously
 * reported gift FMV must also be subtracted from adjusted taxable gifts to
 * prevent double taxation.
 *
 * Trigger conditions (all must hold):
 *   1. The gift event names a life-insurance policy as the transferred asset
 *      (`event.accountId` references an `Account` with
 *      `category === "life_insurance"` and a populated `lifeInsurance` block).
 *   2. The gift's recipient is an irrevocable trust (`entityType === "trust"`
 *      and `isIrrevocable === true`).
 *   3. The gift's grantor matches the deceased.
 *   4. The gift year falls within `(deathYear - 3, deathYear]`:
 *      i.e. `deathYear - giftYear < 3`. Death in the same year, +1, or +2
 *      triggers the lookback; exactly +3 is OUT.
 *
 * Joint-grantor gifts are not currently supported as §2035 triggers — the
 * `GiftEvent.grantor` field carries only `"client" | "spouse"` for asset
 * transfers (joint asset-gifts get attributed to one grantor at fan-out time).
 *
 * The helper has no access to the gift-ledger's `accountValueAtYear` closure,
 * so it cannot compute the exact prior gift FMV. Callers that need the
 * precise exclusion amount should compute it themselves; this helper returns
 * `amountOverride` when set (the advisor-supplied valuation) and 0 otherwise.
 */
export function computeSection2035Lookback(
  input: Section2035Input,
): Section2035Output {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const entityById = new Map(input.entities.map((e) => [e.id, e]));

  const addBackLines: GrossEstateLine[] = [];
  let giftValueToExclude = 0;

  for (const ev of input.giftEvents) {
    if (ev.kind !== "asset") continue;
    if (ev.grantor !== input.deceased) continue;

    const policy = accountById.get(ev.accountId);
    if (!policy) continue;
    if (policy.category !== "life_insurance") continue;
    if (!policy.lifeInsurance) continue;

    // Only entity-recipient gifts can be §2035 trust transfers; gifts to a
    // person / charity have no recipientEntityId and can never be an ILIT.
    if (!ev.recipientEntityId) continue;
    const trust = entityById.get(ev.recipientEntityId);
    if (!trust) continue;
    if (trust.entityType !== "trust") continue;
    if (!trust.isIrrevocable) continue;

    const yearsSince = input.deathYear - ev.year;
    if (yearsSince < 0) continue; // future gift relative to death year — n/a
    if (yearsSince >= 3) continue; // outside the 3-year window

    const percent = ev.percent;
    // Mirror the life-insurance payout transform: resolve the scheduled death
    // benefit for the death year when the policy uses a death-benefit schedule,
    // falling back to the static faceValue otherwise. For an ILIT-gifted policy
    // the §2035 line is the sole inclusion path, so a scheduled (non-flat) death
    // benefit must drive the add-back amount.
    const scheduledDb =
      policy.lifeInsurance.deathBenefitScheduleMode === "scheduled"
        ? resolveScheduledColumnForYear(
            policy.lifeInsurance.cashValueSchedule,
            input.deathYear,
            "deathBenefit",
          )
        : null;
    const dbAtDeath = scheduledDb ?? policy.lifeInsurance.faceValue;
    const faceValue = dbAtDeath * percent;
    if (faceValue <= 0) continue;

    addBackLines.push({
      label: `${policy.name} (§2035 add-back)`,
      accountId: policy.id,
      liabilityId: null,
      percentage: percent,
      amount: faceValue,
      // §2035 add-backs are life-insurance proceeds — non-probate by category.
      isProbate: false,
    });

    if (ev.amountOverride != null && ev.amountOverride > 0) {
      giftValueToExclude += ev.amountOverride;
    }
  }

  return { addBackLines, giftValueToExclude };
}
