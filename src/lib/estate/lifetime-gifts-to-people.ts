import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildGiftValueAtYear } from "@/engine/business/business-tree";
import { collectCharityExternalBeneficiaryIds } from "./charity-recipients";

export interface LifetimeGiftLine {
  label: string;
  amount: number;
  /** A cash gift leaves the projection; an asset gift's share stays on its
   *  account as a `gifted_away` slice until a death partitions it off. */
  kind: "cash" | "asset";
}

export interface LifetimeGiftsToPerson {
  recipient: { kind: "family_member" | "external_beneficiary"; id: string };
  amount: number;
  lines: LifetimeGiftLine[];
}

/**
 * Lifetime gifts to people — family members and external beneficiaries — made
 * on or before `throughYear`, one entry per recipient. Gifts to trusts are not
 * here; they flow through the trust's own accounts.
 *
 * Read from the engine's own gift data, not the editor's drafts: one-off cash
 * gifts from `clientData.gifts`, and from `giftEvents` the per-year rows a
 * recurring gift fanned out to plus account-share (asset) gifts. So a toggled-
 * off gift is already gone, and a cash amount is what the projection took out
 * of household cash (an annual-exclusion series at each year's indexed
 * exclusion). An asset gift counts at its value in the gift year — the same
 * `buildGiftValueAtYear` the gift ledger prices it with — or, without a
 * projection, at the account's authored value. Gifts after `throughYear` are
 * left out: a death in that year means they are never made.
 */
export function lifetimeGiftsToPeople(
  clientData: ClientData,
  throughYear: number,
  projection?: { years: ProjectionYear[] } | null,
): LifetimeGiftsToPerson[] {
  // Built on first use — most plans have no asset gift to a person.
  let giftValueAtYear: ((accountId: string, year: number) => number | undefined) | undefined;
  const accountValue = (accountId: string, year: number): number => {
    if (projection) {
      giftValueAtYear ??= buildGiftValueAtYear(projection.years, clientData.accounts ?? []);
      return giftValueAtYear(accountId, year) ?? 0;
    }
    const account = (clientData.accounts ?? []).find((a) => a.id === accountId);
    return typeof account?.value === "number" ? account.value : 0;
  };

  type Recipients = { recipientFamilyMemberId?: string; recipientExternalBeneficiaryId?: string };
  type Gift = Recipients & {
    year: number;
    amount: number;
    /** Gifts sharing a key fold into one line — a series' yearly rows. */
    lineKey: string;
    shape: "cash gift" | "annual gift" | "asset gift";
  };
  // One-off cash gifts also sit on `giftEvents` (without a `seriesId`), so
  // only series rows are read from there.
  const made: Gift[] = [
    ...(clientData.gifts ?? []).map((g) => ({ ...g, lineKey: g.id, shape: "cash gift" as const })),
    ...(clientData.giftEvents ?? []).flatMap((e, i): Gift[] => {
      if (e.kind === "cash" && e.seriesId != null) {
        return [{ ...e, lineKey: e.seriesId, shape: "annual gift" }];
      }
      if (e.kind === "asset") {
        const amount = e.amountOverride ?? accountValue(e.accountId, e.year) * e.percent;
        return [{ ...e, amount, lineKey: `asset-${i}`, shape: "asset gift" }];
      }
      return [];
    }),
  ]
    .filter((g) => g.year <= throughYear && g.amount > 0)
    .sort((a, b) => a.year - b.year);

  const recipientOf = (g: Recipients): LifetimeGiftsToPerson["recipient"] | null => {
    if (g.recipientFamilyMemberId) return { kind: "family_member", id: g.recipientFamilyMemberId };
    if (g.recipientExternalBeneficiaryId) {
      return { kind: "external_beneficiary", id: g.recipientExternalBeneficiaryId };
    }
    return null; // a trust
  };
  type Line = { shape: Gift["shape"]; first: number; last: number; amount: number };
  const byRecipient = new Map<
    string,
    { recipient: LifetimeGiftsToPerson["recipient"]; lines: Map<string, Line> }
  >();
  for (const g of made) {
    const recipient = recipientOf(g);
    if (!recipient) continue;
    const entry = byRecipient.get(recipient.id) ?? { recipient, lines: new Map() };
    byRecipient.set(recipient.id, entry);
    const line = entry.lines.get(g.lineKey);
    if (line) {
      line.last = g.year;
      line.amount += g.amount;
    } else {
      entry.lines.set(g.lineKey, { shape: g.shape, first: g.year, last: g.year, amount: g.amount });
    }
  }

  const lineLabel = ({ shape, first, last }: Line): string => {
    if (shape === "cash gift") return `Cash gift (${first})`;
    if (shape === "asset gift") return `Asset gift (${first})`;
    return first === last ? `Annual gift (${first})` : `Annual gifts (${first}–${last})`;
  };
  return [...byRecipient.values()].map(({ recipient, lines }) => {
    const out = [...lines.values()].map(
      (l): LifetimeGiftLine => ({
        label: lineLabel(l),
        amount: l.amount,
        kind: l.shape === "asset gift" ? "asset" : "cash",
      }),
    );
    return { recipient, amount: out.reduce((sum, l) => sum + l.amount, 0), lines: out };
  });
}

/**
 * What the household has given its heirs during life, through `throughYear`:
 * `lifetimeGiftsToPeople` less gifts to the couple themselves (a gift to the
 * spouse stays in the household) and to charities (their own bucket).
 */
export function lifetimeGiftsToHeirs(
  clientData: ClientData,
  throughYear: number,
  projection?: { years: ProjectionYear[] } | null,
): number {
  const charityIds = collectCharityExternalBeneficiaryIds(clientData);
  const principalIds = new Set(
    (clientData.familyMembers ?? [])
      .filter((f) => f.role === "client" || f.role === "spouse")
      .map((f) => f.id),
  );
  return lifetimeGiftsToPeople(clientData, throughYear, projection)
    .filter(({ recipient }) => !charityIds.has(recipient.id) && !principalIds.has(recipient.id))
    .reduce((sum, p) => sum + p.amount, 0);
}
