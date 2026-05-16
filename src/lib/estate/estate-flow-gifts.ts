import type { ClientData, Gift, GiftEvent, GiftEventKind } from "@/engine/types";
import { fanOutGiftSeries } from "@/engine/series-fanout";

// ── Public model ─────────────────────────────────────────────────────────────

export type GiftGrantor = "client" | "spouse" | "joint";

export interface GiftRecipientRef {
  kind: "entity" | "family_member" | "external_beneficiary";
  id: string;
}

/** Human-readable noun for a gift recipient's kind. */
export function giftRecipientKindLabel(kind: GiftRecipientRef["kind"]): string {
  return kind === "entity"
    ? "trust"
    : kind === "family_member"
      ? "family member"
      : "beneficiary";
}

export type EstateFlowGift =
  | {
      kind: "cash-once";
      id: string;
      year: number;
      amount: number;
      grantor: GiftGrantor;
      recipient: GiftRecipientRef;
      crummey: boolean;
      /** Non-outright gift kind. Always populated by mappers (DB default is "outright"). */
      eventKind?: GiftEventKind;
    }
  | {
      kind: "asset-once";
      id: string;
      year: number;
      accountId: string;
      percent: number;
      grantor: GiftGrantor;
      recipient: GiftRecipientRef;
      /** Advisor-supplied manual valuation override (mirrors DB `amount` on asset rows). */
      amountOverride?: number;
      /** Non-outright gift kind. Always populated by mappers (DB default is "outright"). */
      eventKind?: GiftEventKind;
    }
  | {
      kind: "series";
      id: string;
      startYear: number;
      endYear: number;
      annualAmount: number;
      inflationAdjust: boolean;
      grantor: "client" | "spouse";
      recipient: GiftRecipientRef; // recipient.kind is always "entity" (irrevocable trust)
      crummey: boolean;
    };

// ── DB-row mappers ───────────────────────────────────────────────────────────

/** Shape of a `gifts` table row as returned by a plain `select()`. */
export interface GiftRow {
  id: string;
  year: number;
  amount: string | null;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
  accountId: string | null;
  liabilityId: string | null;
  percent: string | null;
  useCrummeyPowers: boolean;
  eventKind: GiftEventKind;
}

/** Shape of a `gift_series` table row as returned by a plain `select()`. */
export interface GiftSeriesDbRow {
  id: string;
  grantor: "client" | "spouse";
  recipientEntityId: string;
  startYear: number;
  endYear: number;
  annualAmount: string;
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
}

function recipientFromRow(r: {
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
}): GiftRecipientRef {
  if (r.recipientEntityId) return { kind: "entity", id: r.recipientEntityId };
  if (r.recipientFamilyMemberId)
    return { kind: "family_member", id: r.recipientFamilyMemberId };
  return { kind: "external_beneficiary", id: r.recipientExternalBeneficiaryId ?? "" };
}

/**
 * Map a `gifts` table row to an EstateFlowGift draft.
 * Liability-transfer rows (`liabilityId != null`) are bundled children of an
 * asset gift and are skipped here — returns null for them.
 */
export function giftRowToDraft(row: GiftRow): EstateFlowGift | null {
  if (row.liabilityId != null) return null;
  if (row.accountId != null) {
    return {
      kind: "asset-once",
      id: row.id,
      year: row.year,
      accountId: row.accountId,
      percent: Number(row.percent ?? 0),
      grantor: row.grantor,
      recipient: recipientFromRow(row),
      // Carry advisor-supplied amount override from the DB row.
      amountOverride: row.amount != null ? Number(row.amount) : undefined,
      // Carry eventKind (DB default is "outright"; always present).
      eventKind: row.eventKind,
    };
  }
  return {
    kind: "cash-once",
    id: row.id,
    year: row.year,
    amount: Number(row.amount ?? 0),
    grantor: row.grantor,
    recipient: recipientFromRow(row),
    // Carry useCrummeyPowers from the DB row.
    crummey: row.useCrummeyPowers,
    // Carry eventKind (DB default is "outright"; always present).
    eventKind: row.eventKind,
  };
}

/** Map a `gift_series` table row to an EstateFlowGift draft. */
export function giftSeriesRowToDraft(row: GiftSeriesDbRow): EstateFlowGift {
  return {
    kind: "series",
    id: row.id,
    startYear: row.startYear,
    endYear: row.endYear,
    annualAmount: Number(row.annualAmount),
    inflationAdjust: row.inflationAdjust,
    grantor: row.grantor,
    recipient: { kind: "entity", id: row.recipientEntityId },
    crummey: row.useCrummeyPowers,
  };
}

// ── Immutable list ops ───────────────────────────────────────────────────────

export function addGift(gifts: EstateFlowGift[], gift: EstateFlowGift): EstateFlowGift[] {
  return [...gifts, gift];
}

export function updateGift(gifts: EstateFlowGift[], gift: EstateFlowGift): EstateFlowGift[] {
  return gifts.map((g) => (g.id === gift.id ? gift : g));
}

export function removeGift(gifts: EstateFlowGift[], id: string): EstateFlowGift[] {
  return gifts.filter((g) => g.id !== id);
}

// ── Materialisation ──────────────────────────────────────────────────────────

/**
 * Produce the `ClientData` the engine runs from the working copy + gift drafts.
 * Mirrors the gift transformation in load-client-data.ts so a strip-then-reapply
 * round-trip is identity. Pure — `data` is never mutated.
 *
 * Liability-kind GiftEvents are NOT representable as standalone EstateFlowGift
 * drafts (they are DB-only bundled child rows). Instead they are derived here:
 * for every asset-once gift whose source account has a linked liability, a
 * matching liability GiftEvent is emitted — mirroring the gift route's
 * auto-bundling so a gifted mortgaged asset carries its debt out of the estate.
 * This keeps the estate-flow projection consistent with load-client-data.ts,
 * and works for both saved gifts and unsaved sandbox gifts (the liabilities
 * list is derived self-contained from `data`).
 */
export function applyGiftsToClientData(
  data: ClientData,
  gifts: EstateFlowGift[],
  cpi: number,
): ClientData {
  const cashGifts: Gift[] = [];
  const giftEvents: GiftEvent[] = [];

  for (const g of gifts) {
    if (g.kind === "cash-once") {
      // The loader's mappedGifts omits eventKind from Gift[] entries
      // (the field is optional on Gift and the loader never sets it there).
      // We match that exact behaviour — eventKind is NOT propagated to Gift[].
      // Invariant: cash gifts always carry a non-null amount (DB convention:
      // cash→amount, asset→percent). A null amount would coerce to 0 here via
      // giftRowToDraft, but that path is unreachable in practice.
      cashGifts.push({
        id: g.id,
        year: g.year,
        amount: g.amount,
        grantor: g.grantor,
        recipientEntityId:
          g.recipient.kind === "entity" ? g.recipient.id : undefined,
        recipientFamilyMemberId:
          g.recipient.kind === "family_member" ? g.recipient.id : undefined,
        recipientExternalBeneficiaryId:
          g.recipient.kind === "external_beneficiary" ? g.recipient.id : undefined,
        useCrummeyPowers: g.crummey,
      });
      // GiftEvent cash kind requires recipientEntityId: string (non-optional in
      // the discriminated union). For family_member / external_beneficiary
      // recipients we pass an empty string — matching the loader's `!` assertion
      // pattern which assumes cash gifts always target an entity in practice.
      // Use g.eventKind ?? "outright" to mirror loader's cashFromGifts.
      // The cast drops "joint" from the union. This mirrors load-client-data.ts
      // which performs the identical cast. How the engine handles a "joint" value
      // in a client/spouse field is a pre-existing engine concern, out of scope here.
      giftEvents.push({
        kind: "cash",
        year: g.year,
        amount: g.amount,
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId:
          g.recipient.kind === "entity" ? g.recipient.id : "",
        useCrummeyPowers: g.crummey,
        eventKind: g.eventKind ?? "outright",
      });
    } else if (g.kind === "asset-once") {
      // Use g.eventKind ?? "outright" and pass amountOverride to mirror the
      // loader's assetFromGifts.
      // The cast drops "joint" from the union — identical to load-client-data.ts.
      // How the engine handles a "joint" value in a client/spouse field is a
      // pre-existing engine concern, out of scope for this module.
      giftEvents.push({
        kind: "asset",
        year: g.year,
        accountId: g.accountId,
        percent: g.percent,
        grantor: g.grantor as "client" | "spouse",
        recipientEntityId: g.recipient.id,
        amountOverride: g.amountOverride,
        eventKind: g.eventKind ?? "outright",
      });
      // If the gifted account has a linked liability (a mortgage), the gift
      // route auto-creates a bundled liability child gift row so the debt
      // follows the asset. Mirror that here: emit a matching liability
      // GiftEvent at the same year/grantor/recipient/percent. Without this the
      // estate-flow projection leaves the mortgage with the household after the
      // property has left the estate. parentGiftId references the asset gift's
      // id — the engine uses it only for bundling correlation, not its math.
      const linkedLiability = (data.liabilities ?? []).find(
        (l) => l.linkedPropertyId === g.accountId,
      );
      if (linkedLiability) {
        giftEvents.push({
          kind: "liability",
          year: g.year,
          liabilityId: linkedLiability.id,
          percent: g.percent,
          grantor: g.grantor as "client" | "spouse",
          recipientEntityId: g.recipient.id,
          parentGiftId: g.id,
          eventKind: g.eventKind ?? "outright",
        });
      }
    } else {
      // series
      giftEvents.push(
        ...fanOutGiftSeries(
          {
            id: g.id,
            grantor: g.grantor,
            recipientEntityId: g.recipient.id,
            startYear: g.startYear,
            endYear: g.endYear,
            annualAmount: g.annualAmount,
            inflationAdjust: g.inflationAdjust,
            useCrummeyPowers: g.crummey,
          },
          { cpi },
        ),
      );
    }
  }

  giftEvents.sort((a, b) => a.year - b.year);

  return { ...data, gifts: cashGifts, giftEvents };
}
