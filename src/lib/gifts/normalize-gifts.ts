import type { EntitySummary, Gift, GiftEvent, GiftEventKind } from "@/engine/types";
import {
  computeGiftTaxTreatment,
  type EntityType,
  type GiftTreatment,
} from "./compute-tax-treatment";
import { crummeyBeneficiaryCount } from "./crummey-count";
import {
  discountedGiftValue,
  normalizeValuationDiscount,
} from "./apply-valuation-discount";

export interface CanonicalGift {
  year: number;
  /** Joint gifts are already split into two half-gifts before this point. */
  grantor: "client" | "spouse";
  /**
   * Transfer-tax value AFTER any valuation discount — what
   * `computeGiftTaxTreatment` consumes, and therefore what the §2503(b) annual
   * exclusion is netted against.
   */
  amount: number;
  /** Pre-discount fair market value. Display / report only — never taxed. */
  undiscountedAmount: number;
  /** Normalized discount fraction in [0, 1]. 0 when no discount applies. */
  valuationDiscount: number;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
  useCrummeyPowers: boolean;
  /** Resolved context for `computeGiftTaxTreatment`. */
  entity: { isIrrevocable: boolean; entityType: EntityType } | null;
  external: { kind: "charity" | "individual" } | null;
  crummeyBeneficiaryCount: number;
  /** Provenance for labeling / debugging. */
  source: "legacy" | "event";
  sourcePolicyAccountId?: string;
  /** Non-outright gift kind (e.g. CLT remainder interest), preserved for labeling. */
  eventKind?: GiftEventKind;
}

export interface CanonicalGiftContext {
  entities: EntitySummary[];
  externalBeneficiaries?: Array<{ id: string; kind: "charity" | "individual" }>;
  accountValueAtYear: (accountId: string, year: number) => number;
  entityValueAtYear?: (entityId: string, year: number) => number;
}

type Split = { grantor: "client" | "spouse"; amount: number };

/** Split a possibly-joint grantor into per-grantor halves (§2513). */
function splitGrantor(grantor: "client" | "spouse" | "joint", amount: number): Split[] {
  if (grantor === "joint") {
    return [
      { grantor: "client", amount: amount / 2 },
      { grantor: "spouse", amount: amount / 2 },
    ];
  }
  return [{ grantor, amount }];
}

function resolveEntity(
  recipientEntityId: string | null,
  byId: Map<string, EntitySummary>,
): { entity: CanonicalGift["entity"]; crummeyBeneficiaryCount: number } {
  if (!recipientEntityId) return { entity: null, crummeyBeneficiaryCount: 0 };
  const e = byId.get(recipientEntityId);
  if (!e) return { entity: null, crummeyBeneficiaryCount: 0 };
  return {
    entity: {
      isIrrevocable: e.isIrrevocable ?? false,
      entityType: (e.entityType ?? "trust") as EntityType,
    },
    crummeyBeneficiaryCount: crummeyBeneficiaryCount(e),
  };
}

export function toCanonicalGifts(
  gifts: Gift[],
  giftEvents: GiftEvent[],
  ctx: CanonicalGiftContext,
): CanonicalGift[] {
  const entitiesById = new Map(ctx.entities.map((e) => [e.id, e]));
  const externalById = new Map(
    (ctx.externalBeneficiaries ?? []).map((x) => [x.id, x.kind] as const),
  );
  const out: CanonicalGift[] = [];

  const pushResolved = (
    base: Omit<
      CanonicalGift,
      | "grantor"
      | "amount"
      | "undiscountedAmount"
      | "valuationDiscount"
      | "entity"
      | "crummeyBeneficiaryCount"
      | "external"
    >,
    grantor: "client" | "spouse" | "joint",
    fullValue: number,
    discount: number | null | undefined,
  ) => {
    const { entity, crummeyBeneficiaryCount: count } = resolveEntity(
      base.recipientEntityId,
      entitiesById,
    );
    const external = base.recipientExternalBeneficiaryId
      ? { kind: externalById.get(base.recipientExternalBeneficiaryId) ?? ("individual" as const) }
      : null;
    // THE ONE PLACE the valuation discount is applied. It happens here — above
    // `computeGiftTaxTreatment` — so every one of the seven treatment branches
    // nets its exclusion against the already-discounted value (§2512 then
    // §2503(b)), with no changes to compute-tax-treatment.ts.
    const normalizedDiscount = normalizeValuationDiscount(discount);
    const taxValue = discountedGiftValue(fullValue, discount);
    // §2513 splits a joint gift into halves; both the taxed value and the
    // reported full value split the same way.
    const halves = grantor === "joint" ? 2 : 1;
    for (const s of splitGrantor(grantor, taxValue)) {
      out.push({
        ...base,
        grantor: s.grantor,
        amount: s.amount,
        undiscountedAmount: fullValue / halves,
        valuationDiscount: normalizedDiscount,
        entity,
        external,
        crummeyBeneficiaryCount: count,
      });
    }
  };

  // 1. Legacy cash gifts[] — full recipient info, included verbatim.
  for (const g of gifts) {
    pushResolved(
      {
        year: g.year,
        recipientEntityId: g.recipientEntityId ?? null,
        recipientFamilyMemberId: g.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId ?? null,
        useCrummeyPowers: g.useCrummeyPowers,
        source: "legacy",
        eventKind: g.eventKind,
      },
      g.grantor,
      g.amount,
      g.valuationDiscount,
    );
  }

  // 2. giftEvents[] — dedup'd against the gifts[] cash mirror.
  for (const ev of giftEvents) {
    if (ev.kind === "cash") {
      // Bare one-time cash is mirrored in gifts[] (counted above). Only series
      // fan-outs (seriesId) and synthesized premium gifts (sourcePolicyAccountId)
      // live exclusively in giftEvents[].
      if (ev.seriesId == null && ev.sourcePolicyAccountId == null) continue;
      pushResolved(
        {
          year: ev.year,
          recipientEntityId: ev.recipientEntityId ?? null,
          recipientFamilyMemberId: null,
          recipientExternalBeneficiaryId: null,
          useCrummeyPowers: ev.useCrummeyPowers,
          source: "event",
          sourcePolicyAccountId: ev.sourcePolicyAccountId,
        },
        ev.grantor,
        ev.amount,
        ev.valuationDiscount,
      );
    } else if (ev.kind === "asset") {
      const value =
        ev.amountOverride != null
          ? ev.amountOverride
          : ctx.accountValueAtYear(ev.accountId, ev.year) * ev.percent;
      // Crummey is cash-only: asset transfers consume full lifetime exemption.
      pushResolved(
        {
          year: ev.year,
          recipientEntityId: ev.recipientEntityId ?? null,
          recipientFamilyMemberId: null,
          recipientExternalBeneficiaryId: null,
          useCrummeyPowers: false,
          source: "event",
        },
        ev.grantor,
        value,
        ev.valuationDiscount,
      );
    } else if (ev.kind === "business_interest") {
      const value =
        ev.amountOverride != null
          ? ev.amountOverride
          : (ctx.entityValueAtYear ? ctx.entityValueAtYear(ev.entityId, ev.year) : 0) *
            ev.percent;
      pushResolved(
        {
          year: ev.year,
          recipientEntityId: ev.recipientEntityId ?? null,
          recipientFamilyMemberId: null,
          recipientExternalBeneficiaryId: null,
          useCrummeyPowers: false,
          source: "event",
        },
        ev.grantor,
        value,
        ev.valuationDiscount,
      );
    }
    // `liability` events contribute 0 — skipped.
  }

  return out;
}

/** Apply `computeGiftTaxTreatment` to a canonical gift at a given year's exclusion. */
export function treatCanonicalGift(
  cg: CanonicalGift,
  annualExclusionAmount: number,
): GiftTreatment {
  return computeGiftTaxTreatment(
    {
      amount: cg.amount,
      useCrummeyPowers: cg.useCrummeyPowers,
      recipientEntityId: cg.recipientEntityId,
      recipientFamilyMemberId: cg.recipientFamilyMemberId,
      recipientExternalBeneficiaryId: cg.recipientExternalBeneficiaryId,
    },
    {
      entity: cg.entity ?? undefined,
      external: cg.external ?? undefined,
      annualExclusionAmount,
      crummeyBeneficiaryCount: cg.crummeyBeneficiaryCount,
    },
  );
}
