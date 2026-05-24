import type {
  AssetTransferLine,
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
  ReductionsLine,
} from "@/lib/estate/transfer-report";
import type {
  Account,
  ClientData,
  ProjectionYear,
  RemainderBeneficiaryRef,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  ownedByFamilyMember,
} from "@/engine/ownership";
import { ownersForYearOrHousehold } from "@/lib/estate/owners-or-household";
import { resolveOwnerSlices } from "@/lib/estate/account-owner-slices";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import {
  isPolicyInForce,
  insuredRetirementYearFor,
  resolveOwnerRetirementYears,
} from "@/lib/estate/insurance-in-force";

// Account subTypes that the estate-flow Overview treats as already
// out-of-estate for the household (assets earmarked for heirs that bypass
// the gross estate). The DB schema only models 529 today; UTMA/UGMA are not
// yet first-class subtypes — track in future-work/client-data when added.
const OOE_PERSON_ACCOUNT_SUBTYPES: ReadonlySet<string> = new Set(["529"]);

export interface EstateFlowSummary {
  /** Net worth of whichever spouse survives the first death — sourced from the
   *  decedent in `firstDeath` (or `secondDeath` for single-decedent views), not
   *  the household-role "spouse" — so toggling the death-order picker swaps
   *  which spouse appears on the left rail. Null for single-filer households. */
  survivorNetWorth: {
    ownerLabel: string;
    role: "client" | "spouse";
    amount: number;
    lines: { label: string; amount: number }[];
  } | null;
  firstDeath: DeathStage | null;
  secondDeath: DeathStage | null;
  outOfEstate: {
    heirs: { total: number; entities: OoeEntity[] };
    irrevTrusts: { total: number; entities: OoeEntity[] };
  };
  heirBoxes: HeirBox[];
  totals: { totalTaxesAndExpenses: number; totalToHeirs: number };
}

export interface DeathStage {
  decedentLabel: string;
  year: number;
  /** Net estate flowing through the death event — gross asset transfers
   *  minus any liability transfers that ride along (e.g. a mortgage assumed
   *  with the home). Equals `Σ estateLines.amount`. Distinct from the
   *  Form 706 gross-estate concept in `estate-tax.ts`. */
  estateValue: number;
  estateLines: AssetTransferLine[];
  subBoxes: DeathSubBox[];
}

export type DeathSubBoxKind =
  | "taxes"
  | "trusts"
  | "inheritance_spouse"
  | "heirs_outright";

export interface DeathSubBox {
  kind: DeathSubBoxKind;
  label: string;
  total: number;
  lines: ReductionsLine[] | AssetTransferLine[];
  targetLabel?: string;
}

export interface HeirBox {
  recipientKey: string;
  recipientLabel: string;
  outright: number;
  inTrust: number;
  total: number;
  sections: HeirSection[];
  recipientGroups: {
    firstDeath: RecipientGroup | null;
    secondDeath: RecipientGroup | null;
  };
  trustInterests: { trustId: string; trustLabel: string; amount: number }[];
}

export interface HeirSection {
  title: string;
  lines: { label: string; amount: number }[];
  subtotal?: number;
}

export interface OoeEntity {
  entityId: string;
  entityLabel: string;
  amount: number;
  assets: { label: string; amount: number }[];
}

export interface BuildEstateFlowSummaryInput {
  reportData: EstateTransferReportData;
  clientData: ClientData;
  gifts: EstateFlowGift[];
  ownerNames: { clientName: string; spouseName: string | null };
  /** The year the user selected on the chart's "As Of" dropdown. Used by
   *  `computeOutOfEstate` to compose year-aware ownership and gate
   *  `isPolicyInForce` on trust-owned policies. Callers should pass the
   *  projection's start year when the AsOf selection isn't a concrete year
   *  (e.g. "today" or "split"). */
  asOfYear: number;
  /** Optional projection result. When provided, `computeOutOfEstate` consumes
   *  per-year account balances and locked entity/family shares so the OOE
   *  column reflects gift-driven ownership transfers, growth, and split
   *  ownership at `asOfYear`. Tests that exercise only the heir-box rules can
   *  omit this; the static fallback uses `account.value` and authored
   *  `owners[]` slices. */
  projection?: ProjectionResult | null;
}

// Friendly labels for ReductionsLine kinds, used inside the death-stage taxes box.
const fmtKindLabels: Record<ReductionsLine["kind"], string> = {
  federal_estate_tax: "Federal Estate Tax",
  state_estate_tax: "State Estate Tax",
  admin_expenses: "Admin Expenses",
  debts_paid: "Debts Paid",
  ird_tax: "IRD Tax",
};

// Outright-heir recipient kinds — everything that ends up in the household's
// "to heirs" buckets at the end of the flow (i.e. not the spouse continuing
// the household and not a trust entity).
const OUTRIGHT_HEIR_KINDS: ReadonlySet<RecipientGroup["recipientKind"]> = new Set([
  "family_member",
  "external_beneficiary",
  "system_default",
]);

function buildDeathStage(
  section: DeathSectionData,
  spouseLabel: string | null,
  isFirstDeath: boolean,
  clientData: ClientData,
): DeathStage {
  // Pre-compute the total ledger amount transferred from each source. Used
  // as the denominator when scaling each transfer to its proportional share
  // of the decedent's chargeable dollar cap. We sum over every recipient so
  // a will-split account or a multi-beneficiary policy footing reaches the
  // full ledger total, not just one recipient's slice.
  const totalLedgerByAccount = new Map<string, number>();
  const totalLedgerByLiability = new Map<string, number>();
  for (const r of section.recipients) {
    for (const m of r.byMechanism) {
      for (const a of m.assets) {
        if (a.sourceAccountId != null) {
          totalLedgerByAccount.set(
            a.sourceAccountId,
            (totalLedgerByAccount.get(a.sourceAccountId) ?? 0) + a.amount,
          );
        } else if (a.sourceLiabilityId != null) {
          totalLedgerByLiability.set(
            a.sourceLiabilityId,
            (totalLedgerByLiability.get(a.sourceLiabilityId) ?? 0) + a.amount,
          );
        }
      }
    }
  }

  // Scale a raw transfer amount down to the decedent's chargeable dollar share.
  // The Form 706 gross-estate line gives the *cap* (e.g. $500k of a $1M JTWROS
  // home at first death). Each ledger row from that source takes its
  // proportional slice of that cap: `t.amount × (cap / totalLedger)`. This
  // matters for mixed family + entity accounts, where the engine pre-strips
  // the entity slice off the routed transfer; the ledger amount is the family
  // pool, not the full FMV, so a percentage-of-FMV scaling would double-count.
  // Sources with no gross-estate line (unlinked debts, OOE pour-outs) fall
  // through at full ledger value.
  const chargeable = (line: AssetTransferLine): number => {
    if (line.sourceAccountId != null) {
      const cap = section.grossEstateDollarsByAccount[line.sourceAccountId];
      const total = totalLedgerByAccount.get(line.sourceAccountId);
      if (cap == null || total == null || total === 0) return line.amount;
      return line.amount * (cap / total);
    }
    if (line.sourceLiabilityId != null) {
      const cap = section.grossEstateDollarsByLiability[line.sourceLiabilityId];
      const total = totalLedgerByLiability.get(line.sourceLiabilityId);
      if (cap == null || total == null || total === 0) return line.amount;
      return line.amount * (cap / total);
    }
    return line.amount;
  };

  // Pre-compute scaled amounts once so every downstream sum / consolidation
  // uses the same numbers and the box / sub-box / popover all foot.
  const scaledByRef = new WeakMap<AssetTransferLine, number>();
  const scale = (l: AssetTransferLine): number => {
    const existing = scaledByRef.get(l);
    if (existing !== undefined) return existing;
    const v = chargeable(l);
    scaledByRef.set(l, v);
    return v;
  };

  // Consolidate the popover lines by source — life-insurance policies with
  // two beneficiaries emit one transfer per beneficiary, but to the advisor
  // it's a single $X policy. Joint accounts likewise emit a single transfer
  // but we still key by source to keep the popover one line per asset/debt.
  const estateLines: AssetTransferLine[] = consolidateBySource(
    section.recipients.flatMap((r) =>
      r.byMechanism.flatMap((m) => m.assets.map((a) => ({ line: a, scaled: scale(a) }))),
    ),
  );

  // Entities with recipientKind === "entity" cover trusts, LLCs, S-corps, etc.
  // Narrow the trusts sub-box to actual trust entities by id lookup.
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );

  const subBoxes: DeathSubBox[] = [];

  // Sub-box totals sum each transfer at its chargeable-share amount so they
  // foot to the parent box (which itself equals Σ scaled estate lines).
  const chargeableRecipientTotal = (groups: RecipientGroup[]): number =>
    groups.reduce(
      (s, g) =>
        s +
        g.byMechanism.reduce(
          (ms, m) => ms + m.assets.reduce((as, a) => as + scale(a), 0),
          0,
        ),
      0,
    );

  // taxes — only when there are reductions (federal/state estate, admin, debts, IRD).
  if (section.reductions.length > 0) {
    const taxLines: ReductionsLine[] = section.reductions.map((r) => ({
      kind: r.kind,
      label: fmtKindLabels[r.kind] ?? r.label,
      amount: r.amount,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));
    subBoxes.push({
      kind: "taxes",
      label: "Taxes & Expenses",
      total: taxLines.reduce((s, l) => s + l.amount, 0),
      lines: taxLines,
    });
  }

  // trusts — recipientKind === "entity" narrowed to entities whose entityType is "trust".
  // Non-trust entities (LLCs, partnerships, etc.) fall through; they're not represented
  // in any sub-box yet — tracked as future work.
  const trustGroups = section.recipients.filter(
    (g) =>
      g.recipientKind === "entity" &&
      g.recipientId != null &&
      trustEntityIds.has(g.recipientId),
  );
  if (trustGroups.length > 0) {
    const trustAssets: AssetTransferLine[] = consolidateBySource(
      trustGroups.flatMap((g) =>
        g.byMechanism.flatMap((m) => m.assets.map((a) => ({ line: a, scaled: scale(a) }))),
      ),
    );
    subBoxes.push({
      kind: "trusts",
      label: "Trusts",
      total: chargeableRecipientTotal(trustGroups),
      lines: trustAssets,
    });
  }

  // inheritance_spouse — only at first death, only if a spouse group exists.
  if (isFirstDeath) {
    const spouseGroup = section.recipients.find(
      (g) => g.recipientKind === "spouse" && g.total > 0,
    );
    if (spouseGroup) {
      const spouseAssets: AssetTransferLine[] = consolidateBySource(
        spouseGroup.byMechanism.flatMap((m) =>
          m.assets.map((a) => ({ line: a, scaled: scale(a) })),
        ),
      );
      subBoxes.push({
        kind: "inheritance_spouse",
        label: "Surviving Spouse",
        total: chargeableRecipientTotal([spouseGroup]),
        lines: spouseAssets,
        targetLabel: spouseLabel ? `${spouseLabel}'s Estate` : "Surviving Spouse",
      });
    }
  }

  // heirs_outright — family_member | external_beneficiary | system_default groups,
  // plus non-trust entity recipients (LLCs, partnerships) which would otherwise
  // disappear from the breakdown. Folding them in keeps the visible flow from
  // dropping value silently; nested-entity attribution to ultimate heirs is
  // future work, tracked in future-work/estate.
  const entityNonTrustGroups = section.recipients.filter(
    (g) =>
      g.recipientKind === "entity" &&
      (g.recipientId == null || !trustEntityIds.has(g.recipientId)),
  );
  const outrightGroups = [
    ...section.recipients.filter((g) => OUTRIGHT_HEIR_KINDS.has(g.recipientKind)),
    ...entityNonTrustGroups,
  ];
  if (outrightGroups.length > 0) {
    const outrightAssets: AssetTransferLine[] = consolidateBySource(
      outrightGroups.flatMap((g) =>
        g.byMechanism.flatMap((m) => m.assets.map((a) => ({ line: a, scaled: scale(a) }))),
      ),
    );
    subBoxes.push({
      kind: "heirs_outright",
      label: "Heirs",
      total: chargeableRecipientTotal(outrightGroups),
      lines: outrightAssets,
    });
  }

  // estateValue equals Σ estateLines (each line at the decedent's chargeable
  // share). For a sole-decedent household this matches asset transfers minus
  // assumed debts; for joint accounts at first death only the decedent's 50%
  // counts. Lines up with Form 706 gross estate in the Estate Tax view.
  return {
    decedentLabel: `${section.decedentName}'s Estate`,
    year: section.year,
    estateValue: estateLines.reduce((s, l) => s + l.amount, 0),
    estateLines,
    subBoxes,
  };
}

/**
 * Collapses transfer rows down to one row per source — life-insurance with
 * two beneficiaries emits two ledger lines for the same policy, joint
 * accounts may emit multiple split rows, etc. Sums the *scaled* amount per
 * source so each row already carries its chargeable-share value. Preserves
 * the basis / conflict-id / distributionForm metadata from the first row
 * encountered for that source (display fields, not financial).
 */
function consolidateBySource(
  entries: { line: AssetTransferLine; scaled: number }[],
): AssetTransferLine[] {
  const byKey = new Map<string, { line: AssetTransferLine; amount: number }>();
  let synthIdx = 0;
  for (const { line, scaled } of entries) {
    const key =
      line.sourceAccountId != null
        ? `acct:${line.sourceAccountId}`
        : line.sourceLiabilityId != null
          ? `liab:${line.sourceLiabilityId}`
          : `none:${synthIdx++}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += scaled;
    } else {
      byKey.set(key, { line, amount: scaled });
    }
  }
  return [...byKey.values()].map(({ line, amount }) => ({
    ...line,
    amount,
  }));
}

/**
 * Survivor's net-worth box on the left rail of the chart — `Σ pct × value`
 * over every account in which they hold any household-side ownership, minus
 * the same percent-weighted share of every liability. Joint accounts thus
 * contribute their share (e.g. 50% of a JTWROS home), matching how the
 * first-death stage box already scales decedent transfers by
 * `grossEstateDollarsByAccount`. Returns null when there's no surviving spouse
 * (single-filer household).
 */
function computeSurvivorNetWorth(
  clientData: ClientData,
  survivor: { role: "client" | "spouse"; label: string } | null,
): EstateFlowSummary["survivorNetWorth"] {
  if (!survivor) return null;
  const survivorFmId = (clientData.familyMembers ?? []).find(
    (fm) => fm.role === survivor.role,
  )?.id;
  if (!survivorFmId) {
    return { ownerLabel: survivor.label, role: survivor.role, amount: 0, lines: [] };
  }
  const lines: { label: string; amount: number }[] = [];
  for (const account of clientData.accounts ?? []) {
    const pct = ownedByFamilyMember(account, survivorFmId);
    if (pct <= 0) continue;
    const value = typeof account.value === "number" ? account.value : 0;
    const amount = value * pct;
    if (amount === 0) continue;
    lines.push({ label: account.name, amount });
  }
  for (const liability of clientData.liabilities ?? []) {
    const pct = ownedByFamilyMember(liability, survivorFmId);
    if (pct <= 0) continue;
    const balance = typeof liability.balance === "number" ? liability.balance : 0;
    const amount = -balance * pct;
    if (amount === 0) continue;
    lines.push({ label: liability.name, amount });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { ownerLabel: survivor.label, role: survivor.role, amount: total, lines };
}

function accountAmount(a: Account): number {
  return typeof a.value === "number" ? a.value : 0;
}

/**
 * Group out-of-estate balances for the Overview's right rail at `asOfYear`:
 *
 *  - **irrevTrusts**: per irrevocable trust, the sum of every account slice the
 *    trust owns at that year (composing static `account.owners` with any prior
 *    `clientData.giftEvents`, then resolving locked entity/family shares from
 *    the projection year row). Trust-owned in-force life insurance where the
 *    trust is a named primary beneficiary (or no beneficiaries are set) is
 *    swapped to face value × ownership percent — that's the ILIT pattern.
 *  - **heirs**: person-owned OOE accounts (today: 529 plans) at their year-aware
 *    balance, PLUS one synthetic entity per family member who has received
 *    cumulative cash gifts on or before `asOfYear`. Cash gifts to persons sit
 *    as a nominal balance (no growth — there's no tracked account on the
 *    recipient side); cash gifts to trusts already flow through the trust's
 *    own account slices via the projection.
 *
 * `projection` is optional: when omitted, the function falls back to static
 * account values + authored ownership (the pre-projection behavior, used by
 * fixture tests). With a projection, ownership is composed via
 * `ownersForYearOrHousehold`, balances are read from `accountLedgers.endingValue`
 * at the matching year row, and `resolveOwnerSlices` distributes locked shares.
 */
function computeOutOfEstate(
  clientData: ClientData,
  asOfYear: number,
  gifts: EstateFlowGift[],
  projection: ProjectionResult | null | undefined,
): EstateFlowSummary["outOfEstate"] {
  const accounts = clientData.accounts ?? [];
  const entities = clientData.entities ?? [];
  const giftEvents = clientData.giftEvents ?? [];

  // Locate the projection year row for `asOfYear`. When the projection doesn't
  // cover that year (e.g. a fixture without a projection, or an AsOf selection
  // past plan-end), fall back to static account values and authored ownership.
  const yearRow: ProjectionYear | undefined = projection?.years.find(
    (y) => y.year === asOfYear,
  );
  const projectionStartYear = projection?.years[0]?.year ?? asOfYear;

  const balanceAt = (accountId: string, account: Account): number => {
    if (yearRow) {
      const ledger = yearRow.accountLedgers?.[accountId];
      if (ledger) return ledger.endingValue;
    }
    return accountAmount(account);
  };

  const ownersAt = (account: Account) => {
    if (!yearRow) return account.owners ?? [];
    try {
      return ownersForYearOrHousehold(
        account,
        giftEvents,
        asOfYear,
        projectionStartYear,
      );
    } catch {
      // Malformed gift events (overdraw / sum-to-1 violations) shouldn't crash
      // the chart; fall back to authored owners so the panel still renders.
      return account.owners ?? [];
    }
  };

  const { clientRetirementYear, spouseRetirementYear } = clientData.client
    ? resolveOwnerRetirementYears(clientData.client)
    : { clientRetirementYear: null, spouseRetirementYear: null };

  // Build a per-account slice map keyed by (accountId → entityId → dollars).
  // `resolveOwnerSlices` distributes the year-aware balance across all owners
  // using the engine's locked-share carry-forward so household drawdowns on a
  // split-owned account don't bleed into entity slices.
  const entitySliceByAccount = new Map<string, Map<string, number>>();
  const entityPercentByAccount = new Map<string, Map<string, number>>();
  for (const account of accounts) {
    const owners = ownersAt(account);
    const value = balanceAt(account.id, account);
    const slices = resolveOwnerSlices(
      account.id,
      owners,
      value,
      yearRow?.entityAccountSharesEoY,
      yearRow?.familyAccountSharesEoY,
    );
    const sliceByEntity = new Map<string, number>();
    for (const s of slices) {
      if (s.owner.kind !== "entity") continue;
      sliceByEntity.set(
        s.owner.entityId,
        (sliceByEntity.get(s.owner.entityId) ?? 0) + s.value,
      );
    }
    entitySliceByAccount.set(account.id, sliceByEntity);
    const pctByEntity = new Map<string, number>();
    for (const o of owners) {
      if (o.kind !== "entity") continue;
      pctByEntity.set(o.entityId, (pctByEntity.get(o.entityId) ?? 0) + o.percent);
    }
    entityPercentByAccount.set(account.id, pctByEntity);
  }

  // Irrevocable trusts → one OoeEntity each. Include trusts with no funded
  // accounts so empty SLAT/ILIT/IDGT shells still surface on the chart
  // (advisor expectation: planning vehicles shouldn't silently disappear).
  const irrevTrustEntities: OoeEntity[] = [];
  for (const entity of entities) {
    if (entity.entityType !== "trust") continue;
    if (entity.isIrrevocable !== true) continue;

    const assets: { label: string; amount: number }[] = [];
    for (const account of accounts) {
      const ownerPct =
        entityPercentByAccount.get(account.id)?.get(entity.id) ?? 0;

      // ILIT face-value swap: trust-owned in-force life insurance where the
      // trust is the named primary beneficiary (or no beneficiaries are set —
      // legacy data, when the UI didn't yet support setting a trust as bene)
      // is shown at death benefit × trust's ownership percent, not cash value.
      // Checked BEFORE the slice-value short-circuit because term policies
      // typically carry cash value $0 — gating on slice would drop them. A
      // non-trust primary bene on a trust-owned policy is a malformed ILIT —
      // falls through to cash value as a diagnostic. Gated on
      // `isPolicyInForce` so a lapsed term policy doesn't keep contributing
      // $1M forever.
      if (
        ownerPct > 0 &&
        account.category === "life_insurance" &&
        account.lifeInsurance
      ) {
        const bens = account.beneficiaries ?? [];
        const trustIsNamedBene =
          bens.length === 0 ||
          bens.some(
            (b) => b.tier === "primary" && b.entityIdRef === entity.id,
          );
        if (trustIsNamedBene) {
          const insuredRetYear = insuredRetirementYearFor(
            account,
            clientRetirementYear,
            spouseRetirementYear,
          );
          if (isPolicyInForce(account, asOfYear, insuredRetYear)) {
            assets.push({
              label: `${account.name} (death benefit)`,
              amount: account.lifeInsurance.faceValue * ownerPct,
            });
            continue;
          }
        }
      }

      const sliceValue =
        entitySliceByAccount.get(account.id)?.get(entity.id) ?? 0;
      if (sliceValue <= 0) continue;
      assets.push({ label: account.name, amount: sliceValue });
    }

    const amount = assets.reduce((s, x) => s + x.amount, 0);
    irrevTrustEntities.push({
      entityId: entity.id,
      entityLabel: entity.name ?? "Irrevocable Trust",
      amount,
      assets,
    });
  }
  const irrevTotal = irrevTrustEntities.reduce((s, e) => s + e.amount, 0);

  // OOE Heirs: person-owned OOE accounts (529s) at year-aware balance, plus
  // one synthetic entity per family member with cumulative cash gifts on or
  // before `asOfYear`. Bare cash gifts to persons carry no tracked account
  // on the recipient side, so they sit as a nominal balance — growth on a
  // gifted balance only happens when the gift lands in (or transfers
  // ownership of) an account that itself grows in the projection.
  const heirEntities: OoeEntity[] = [];
  for (const account of accounts) {
    if (!OOE_PERSON_ACCOUNT_SUBTYPES.has(account.subType)) continue;
    const amount = balanceAt(account.id, account);
    if (amount <= 0) continue;
    heirEntities.push({
      entityId: account.id,
      entityLabel: account.name,
      amount,
      assets: [{ label: account.name, amount }],
    });
  }

  // Cumulative cash gifts to family members up to `asOfYear`. Series gifts
  // and asset gifts target entities only — series flows ride the trust's
  // account slices above; asset gifts to family members aren't representable
  // on the engine side (the `GiftEvent` recipient is entity-only), so they
  // never reach this branch.
  const giftsByFm = new Map<
    string,
    { label: string; amount: number; gifts: { label: string; amount: number }[] }
  >();
  for (const gift of gifts) {
    if (gift.kind !== "cash-once") continue;
    if (gift.recipient.kind !== "family_member") continue;
    if (gift.year > asOfYear) continue;
    if (gift.amount <= 0) continue;
    const fmId = gift.recipient.id;
    const label = familyMemberLabel(fmId, clientData);
    const existing = giftsByFm.get(fmId) ?? { label, amount: 0, gifts: [] };
    existing.amount += gift.amount;
    existing.gifts.push({ label: `Cash gift (${gift.year})`, amount: gift.amount });
    giftsByFm.set(fmId, existing);
  }
  for (const [fmId, agg] of giftsByFm) {
    heirEntities.push({
      entityId: fmId,
      entityLabel: agg.label,
      amount: agg.amount,
      assets: agg.gifts,
    });
  }

  const heirsTotal = heirEntities.reduce((s, e) => s + e.amount, 0);

  return {
    heirs: { total: heirsTotal, entities: heirEntities },
    irrevTrusts: { total: irrevTotal, entities: irrevTrustEntities },
  };
}

interface HeirAccumulator {
  recipientKey: string;
  recipientLabel: string;
  outright: number;
  inTrust: number;
  firstDeathGroup: RecipientGroup | null;
  secondDeathGroup: RecipientGroup | null;
  trustInterests: { trustId: string; trustLabel: string; amount: number }[];
}

function emptyHeirAcc(key: string, label: string): HeirAccumulator {
  return {
    recipientKey: key,
    recipientLabel: label,
    outright: 0,
    inTrust: 0,
    firstDeathGroup: null,
    secondDeathGroup: null,
    trustInterests: [],
  };
}

interface HeirSectionAccumulator {
  priorTransfers: { label: string; amount: number }[];
  firstDeath: { label: string; amount: number }[];
  secondDeath: { label: string; amount: number }[];
  trustInterests: { label: string; amount: number }[];
}

function emptySectionAcc(): HeirSectionAccumulator {
  return {
    priorTransfers: [],
    firstDeath: [],
    secondDeath: [],
    trustInterests: [],
  };
}

function getSectionAcc(
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  key: string,
): HeirSectionAccumulator {
  let entry = sectionsByHeir.get(key);
  if (!entry) {
    entry = emptySectionAcc();
    sectionsByHeir.set(key, entry);
  }
  return entry;
}

function trustLabel(entityId: string, clientData: ClientData): string {
  const e = (clientData.entities ?? []).find((x) => x.id === entityId);
  return e?.name ?? entityId;
}

function keyForGroup(g: RecipientGroup): string {
  return g.recipientId ?? `${g.recipientKind}:${g.recipientLabel}`;
}

interface TrustBeneficiarySplit {
  recipientKey: string;
  recipientLabel: string;
  /** 0..1 — weights sum to 1.0 across the splits returned for a given trust. */
  weight: number;
}

/**
 * Resolve a family-member / household-role id to a display name.
 * Falls back to the raw id when no match is found — keeps downstream rendering
 * stable when client data is stale or hand-edited.
 */
function familyMemberLabel(id: string, clientData: ClientData): string {
  if (id === "client") {
    const c = clientData.client;
    return `${c.firstName}${c.lastName ? " " + c.lastName : ""}`;
  }
  if (id === "spouse") {
    const c = clientData.client;
    if (c.spouseName) return c.spouseName;
    const spouseFm = (clientData.familyMembers ?? []).find(
      (f) => f.role === "spouse",
    );
    if (spouseFm) {
      return `${spouseFm.firstName}${spouseFm.lastName ? " " + spouseFm.lastName : ""}`;
    }
    return id;
  }
  const fm = (clientData.familyMembers ?? []).find((f) => f.id === id);
  if (fm) {
    return `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
  }
  return id;
}

function externalBeneficiaryLabel(id: string, clientData: ClientData): string {
  const ext = (clientData.externalBeneficiaries ?? []).find((e) => e.id === id);
  return ext?.name ?? id;
}

/**
 * Resolve a trust entity to its beneficiary splits for heir-box attribution.
 * Prefers `remainderBeneficiaries`; falls back to `incomeBeneficiaries` when
 * remainder is empty. Returns [] when neither is populated or the entity is
 * not a trust.
 *
 * Weights are derived from explicit `percentage` when the sum is > 0; an
 * equal split is used otherwise. Per-beneficiary identity prefers
 * `familyMemberId`, then `externalBeneficiaryId`. Beneficiaries that point at
 * another entity (`entityIdRef`) are skipped — chasing nested trusts is left
 * to a later rule.
 */
function resolveTrustBeneficiaries(
  entityId: string,
  clientData: ClientData,
): TrustBeneficiarySplit[] {
  const entity = (clientData.entities ?? []).find((e) => e.id === entityId);
  if (!entity || entity.entityType !== "trust") return [];

  type BeneRef = RemainderBeneficiaryRef | {
    familyMemberId?: string;
    externalBeneficiaryId?: string;
    entityId?: string;
    householdRole?: "client" | "spouse";
    percentage: number;
  };

  const remainder = entity.remainderBeneficiaries ?? [];
  const income = entity.incomeBeneficiaries ?? [];
  const source: BeneRef[] = remainder.length > 0 ? remainder : income;
  if (source.length === 0) return [];

  type Resolved = { key: string; label: string; percentage: number };
  const resolved: Resolved[] = [];
  for (const b of source) {
    let key: string | null = null;
    let label: string | null = null;
    if (b.familyMemberId) {
      key = b.familyMemberId;
      label = familyMemberLabel(b.familyMemberId, clientData);
    } else if (b.householdRole) {
      // Mirror the engine: a householdRole beneficiary resolves to the
      // matching familyMembers[] id so trust contributions merge with that
      // person's at-death residuary box (which is keyed by familyMemberId).
      const roleFm = (clientData.familyMembers ?? []).find(
        (f) => f.role === b.householdRole,
      );
      key = roleFm?.id ?? b.householdRole;
      label = familyMemberLabel(roleFm?.id ?? b.householdRole, clientData);
    } else if (b.externalBeneficiaryId) {
      key = b.externalBeneficiaryId;
      label = externalBeneficiaryLabel(b.externalBeneficiaryId, clientData);
    } else {
      // entityIdRef / entityId — nested-trust attribution is out of scope here.
      continue;
    }
    resolved.push({
      key,
      label,
      percentage: typeof b.percentage === "number" ? b.percentage : 0,
    });
  }
  if (resolved.length === 0) return [];

  const pctSum = resolved.reduce((s, r) => s + r.percentage, 0);
  const weights: number[] =
    pctSum > 0
      ? resolved.map((r) => r.percentage / pctSum)
      : resolved.map(() => 1 / resolved.length);

  return resolved.map((r, i) => ({
    recipientKey: r.key,
    recipientLabel: r.label,
    weight: weights[i],
  }));
}

/**
 * Rule 2 — bequests with `recipientKind === "entity"` whose target entity is
 * a trust are attributed to that trust's beneficiaries as `inTrust`. Each
 * `g.netTotal` is apportioned by the beneficiary weights returned by
 * `resolveTrustBeneficiaries`. Non-trust entity bequests (LLCs / S-corps /
 * etc.) and trust bequests with no resolvable beneficiaries fall through —
 * later rules pick them up.
 */
function collectTrustBequestsInTrust(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  death: DeathSectionData | null,
  clientData: ClientData,
): void {
  if (!death) return;
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );
  for (const g of death.recipients) {
    if (g.recipientKind !== "entity") continue;
    if (!g.recipientId || !trustEntityIds.has(g.recipientId)) continue;
    const splits = resolveTrustBeneficiaries(g.recipientId, clientData);
    if (splits.length === 0) continue;
    const label = trustLabel(g.recipientId, clientData);
    for (const s of splits) {
      const entry =
        acc.get(s.recipientKey) ?? emptyHeirAcc(s.recipientKey, s.recipientLabel);
      const amount = g.netTotal * s.weight;
      entry.inTrust += amount;
      entry.trustInterests.push({
        trustId: g.recipientId,
        trustLabel: label,
        amount,
      });
      acc.set(s.recipientKey, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
      sectionEntry.trustInterests.push({
        label,
        amount,
      });
    }
  }
}

/**
 * Rule 3 — out-of-estate balances attribute to their beneficiaries:
 *  - Person-owned OOE accounts (529 plans): each `OoeEntity.entityId` is the
 *    source account id. The account's `beneficiaries[]` are filtered to the
 *    primary tier with a resolvable `familyMemberId` / `householdRole`. Weights
 *    are proportional to `percentage` (equal split when the sum is zero) and
 *    the amount lands in each beneficiary's `outright`.
 *  - Irrevocable trusts: `resolveTrustBeneficiaries` (same helper as rule 2)
 *    picks remainder beneficiaries; the trust's amount is apportioned by
 *    weight into each beneficiary's `inTrust`.
 *
 * Beneficiaries that point to another entity, an external beneficiary, or
 * have no resolvable identity are skipped — leftover percentage falls through
 * silently to keep the heir-box totals stable.
 */
function collectOoeAttribution(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  ooe: EstateFlowSummary["outOfEstate"],
  clientData: ClientData,
): void {
  // Person-owned OOE accounts (529s) → primary beneficiaries get Outright.
  const accountsById = new Map(
    (clientData.accounts ?? []).map((a) => [a.id, a] as const),
  );
  for (const entity of ooe.heirs.entities) {
    const account = accountsById.get(entity.entityId);
    if (!account) continue;
    type Resolved = { key: string; label: string; percentage: number };
    const resolved: Resolved[] = [];
    for (const b of account.beneficiaries ?? []) {
      if (b.tier !== "primary") continue;
      let key: string | null = null;
      let label: string | null = null;
      if (b.familyMemberId) {
        key = b.familyMemberId;
        label = familyMemberLabel(b.familyMemberId, clientData);
      } else if (b.householdRole) {
        key = b.householdRole;
        label = familyMemberLabel(b.householdRole, clientData);
      } else {
        // External beneficiaries / nested-entity targets fall through here.
        continue;
      }
      resolved.push({
        key,
        label,
        percentage: typeof b.percentage === "number" ? b.percentage : 0,
      });
    }
    if (resolved.length === 0) continue;
    const pctSum = resolved.reduce((s, r) => s + r.percentage, 0);
    const weights =
      pctSum > 0
        ? resolved.map((r) => r.percentage / pctSum)
        : resolved.map(() => 1 / resolved.length);
    resolved.forEach((r, i) => {
      const entry = acc.get(r.key) ?? emptyHeirAcc(r.key, r.label);
      entry.outright += entity.amount * weights[i];
      acc.set(r.key, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, r.key);
      sectionEntry.priorTransfers.push({
        label: entity.entityLabel,
        amount: entity.amount * weights[i],
      });
    });
  }

  // Irrevocable trusts → remainder beneficiaries get inTrust.
  for (const entity of ooe.irrevTrusts.entities) {
    const splits = resolveTrustBeneficiaries(entity.entityId, clientData);
    if (splits.length === 0) continue;
    for (const s of splits) {
      const entry =
        acc.get(s.recipientKey) ?? emptyHeirAcc(s.recipientKey, s.recipientLabel);
      const amount = entity.amount * s.weight;
      entry.inTrust += amount;
      entry.trustInterests.push({
        trustId: entity.entityId,
        trustLabel: entity.entityLabel,
        amount,
      });
      acc.set(s.recipientKey, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
      sectionEntry.trustInterests.push({
        label: entity.entityLabel,
        amount,
      });
    }
  }
}

/**
 * Nominal total dollar amount transferred by a lifetime gift, matching the
 * Sankey's value computation:
 *  - cash-once → `amount`
 *  - asset-once → `amountOverride ?? account.value * percent`
 *  - series → `annualAmount * (endYear - startYear + 1)` (nominal — series
 *             inflation growth is intentionally not modelled here)
 *
 * Returns 0 when an asset gift's source account can't be resolved.
 */
function giftTotalAmount(gift: EstateFlowGift, clientData: ClientData): number {
  if (gift.kind === "cash-once") return gift.amount;
  if (gift.kind === "asset-once") {
    if (gift.amountOverride != null) return gift.amountOverride;
    const account = (clientData.accounts ?? []).find(
      (a) => a.id === gift.accountId,
    );
    if (!account) return 0;
    const value = typeof account.value === "number" ? account.value : 0;
    return value * gift.percent;
  }
  // series
  const years = gift.endYear - gift.startYear + 1;
  return gift.annualAmount * Math.max(0, years);
}

/**
 * Rules 4 & 5 — lifetime gifts.
 *  - Gift to a family member → that person's `outright` gets the full amount.
 *  - Gift to a trust entity → the trust's beneficiaries' `inTrust` get the
 *    amount apportioned by `resolveTrustBeneficiaries` weights.
 *  - Gift to a non-trust entity (LLC etc.) or external beneficiary → skipped
 *    (no estate-side heir box to attribute to).
 */
function giftLineLabel(gift: EstateFlowGift): string {
  // EstateFlowGift carries no human label; mint one from the kind so the
  // heir panel's Prior Transfers / Trust Interests rows aren't all "Gift".
  if (gift.kind === "cash-once") return `Cash gift (${gift.year})`;
  if (gift.kind === "asset-once") return `Asset gift (${gift.year})`;
  return `Annual gifts (${gift.startYear}–${gift.endYear})`;
}

function collectLifetimeGifts(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  gifts: EstateFlowGift[],
  clientData: ClientData,
): void {
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );
  for (const gift of gifts) {
    const amount = giftTotalAmount(gift, clientData);
    if (amount <= 0) continue;
    const recipient = gift.recipient;
    if (recipient.kind === "family_member") {
      const label = familyMemberLabel(recipient.id, clientData);
      const entry = acc.get(recipient.id) ?? emptyHeirAcc(recipient.id, label);
      entry.outright += amount;
      acc.set(recipient.id, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, recipient.id);
      sectionEntry.priorTransfers.push({
        label: giftLineLabel(gift),
        amount,
      });
    } else if (recipient.kind === "entity") {
      if (!trustEntityIds.has(recipient.id)) continue;
      const splits = resolveTrustBeneficiaries(recipient.id, clientData);
      if (splits.length === 0) continue;
      const label = trustLabel(recipient.id, clientData);
      for (const s of splits) {
        const entry =
          acc.get(s.recipientKey) ??
          emptyHeirAcc(s.recipientKey, s.recipientLabel);
        const split = amount * s.weight;
        entry.inTrust += split;
        entry.trustInterests.push({
          trustId: recipient.id,
          trustLabel: label,
          amount: split,
        });
        acc.set(s.recipientKey, entry);

        const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
        sectionEntry.trustInterests.push({
          label,
          amount: split,
        });
      }
    }
    // external_beneficiary → no household-side heir box; skip.
  }
}

/**
 * Rule 1 — at-death receipts go to Outright for person-like recipients
 * (family_member / external_beneficiary / system_default). Accumulates
 * `RecipientGroup.netTotal` (gross minus this recipient's drain share) into
 * a shared map keyed by recipient identity, so contributions across both
 * deaths land in the same heir box.
 */
function collectAtDeathOutright(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  death: DeathSectionData | null,
  bucket: "firstDeath" | "secondDeath",
): void {
  if (!death) return;
  for (const g of death.recipients) {
    if (!OUTRIGHT_HEIR_KINDS.has(g.recipientKind)) continue;
    const key = keyForGroup(g);
    const entry = acc.get(key) ?? emptyHeirAcc(key, g.recipientLabel);
    entry.outright += g.netTotal;
    // One group per recipientId per death is expected; last-write-wins
    // is acceptable for the unlikely collision case.
    if (bucket === "firstDeath") entry.firstDeathGroup = g;
    else entry.secondDeathGroup = g;
    acc.set(key, entry);

    // Section lines use the gross asset amounts. Drain attribution per asset
    // line is future work — the bucket subtotal therefore reflects gross
    // receipts while the heir-box `outright` carries the net.
    const sectionEntry = getSectionAcc(sectionsByHeir, key);
    for (const m of g.byMechanism) {
      for (const a of m.assets) {
        sectionEntry[bucket].push({ label: a.label, amount: a.amount });
      }
    }
  }
}

function buildHeirSections(
  acc: HeirSectionAccumulator,
  firstDecedentLabel: string | null,
  secondDecedentLabel: string | null,
): HeirSection[] {
  const sections: HeirSection[] = [];
  const pushIfAny = (
    title: string,
    lines: { label: string; amount: number }[],
  ) => {
    if (lines.length === 0) return;
    sections.push({
      title,
      lines,
      subtotal: lines.reduce((s, l) => s + l.amount, 0),
    });
  };

  pushIfAny("Prior Transfers", acc.priorTransfers);
  if (firstDecedentLabel != null) {
    pushIfAny(`At ${firstDecedentLabel}'s Death`, acc.firstDeath);
  }
  if (secondDecedentLabel != null) {
    pushIfAny(`At ${secondDecedentLabel}'s Death`, acc.secondDeath);
  }
  pushIfAny("Trust Interests", acc.trustInterests);
  return sections;
}

function finalizeHeirBoxes(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  firstDecedentLabel: string | null,
  secondDecedentLabel: string | null,
): HeirBox[] {
  return [...acc.values()]
    .map((h) => ({
      recipientKey: h.recipientKey,
      recipientLabel: h.recipientLabel,
      outright: h.outright,
      inTrust: h.inTrust,
      total: h.outright + h.inTrust,
      sections: buildHeirSections(
        sectionsByHeir.get(h.recipientKey) ?? emptySectionAcc(),
        firstDecedentLabel,
        secondDecedentLabel,
      ),
      recipientGroups: {
        firstDeath: h.firstDeathGroup,
        secondDeath: h.secondDeathGroup,
      },
      trustInterests: h.trustInterests,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Per-trust sum of cumulative gift-derived dollar amounts that rule 5 will
 * attribute to that trust's beneficiaries' inTrust. Used to subtract from the
 * year-aware OOE balance before it feeds rule 3, so the two rules don't
 * double-count gift-driven trust value.
 *
 * Series gifts use the full series total (matching what `collectLifetimeGifts`
 * attributes), since the heir-box represents the heir's eventual inheritance
 * total, not just the part that's already vested. Cash + asset use
 * `giftTotalAmount` for the same reason.
 */
function sumPastGiftsByTrustForAttribution(
  gifts: EstateFlowGift[],
  asOfYear: number,
  clientData: ClientData,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const gift of gifts) {
    if (gift.recipient.kind !== "entity") continue;
    // Only count gifts that have at least started by asOfYear; future gifts
    // haven't moved value into the OOE column yet, so subtraction would
    // double-undercount.
    const startYear = gift.kind === "series" ? gift.startYear : gift.year;
    if (startYear > asOfYear) continue;
    const amount = giftTotalAmount(gift, clientData);
    if (amount <= 0) continue;
    result.set(
      gift.recipient.id,
      (result.get(gift.recipient.id) ?? 0) + amount,
    );
  }
  return result;
}

function subtractPastGiftsForAttribution(
  ooe: EstateFlowSummary["outOfEstate"],
  gifts: EstateFlowGift[],
  asOfYear: number,
  clientData: ClientData,
): EstateFlowSummary["outOfEstate"] {
  const giftsByTrust = sumPastGiftsByTrustForAttribution(gifts, asOfYear, clientData);
  if (giftsByTrust.size === 0) return ooe;
  const irrevEntities = ooe.irrevTrusts.entities.map((e) => {
    const subtract = giftsByTrust.get(e.entityId) ?? 0;
    if (subtract <= 0) return e;
    return { ...e, amount: Math.max(0, e.amount - subtract) };
  });
  return {
    heirs: ooe.heirs,
    irrevTrusts: {
      total: irrevEntities.reduce((s, e) => s + e.amount, 0),
      entities: irrevEntities,
    },
  };
}

export function buildEstateFlowSummary(
  input: BuildEstateFlowSummaryInput,
): EstateFlowSummary | null {
  const { reportData, clientData, ownerNames } = input;
  if (reportData.isEmpty) return null;

  const firstDeath = reportData.firstDeath
    ? buildDeathStage(
        reportData.firstDeath,
        // The surviving spouse's label is the non-decedent owner.
        reportData.firstDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        true,
        clientData,
      )
    : null;

  const secondDeath = reportData.secondDeath
    ? buildDeathStage(
        reportData.secondDeath,
        reportData.secondDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        false,
        clientData,
      )
    : null;

  // The survivor of the first death sits on the left rail. With a death-order
  // toggle in the chart UI, the decedent picked for `firstDeath` flips and the
  // survivor flips with it — driving from `firstDeath.decedent` (falling back
  // to `secondDeath.decedent`'s opposite when only a second death is rendered)
  // keeps the left box in sync with the toggle.
  const decedent =
    reportData.firstDeath?.decedent ?? reportData.secondDeath?.decedent ?? null;
  const survivorRole: "client" | "spouse" | null =
    decedent === "client" ? "spouse" : decedent === "spouse" ? "client" : null;
  const survivorLabel =
    survivorRole === "client"
      ? ownerNames.clientName
      : survivorRole === "spouse"
        ? ownerNames.spouseName
        : null;
  const survivor =
    survivorRole && survivorLabel
      ? { role: survivorRole, label: survivorLabel }
      : null;
  const survivorNetWorth = computeSurvivorNetWorth(clientData, survivor);

  const outOfEstate = computeOutOfEstate(
    clientData,
    input.asOfYear,
    input.gifts,
    input.projection ?? null,
  );

  // When a projection is provided, `outOfEstate.irrevTrusts.entities[].amount`
  // is year-aware: it includes any trust balance that arrived via gift events
  // composed up to `asOfYear`. Rule 5 (`collectLifetimeGifts`) separately
  // attributes the same gifts to the trust's beneficiaries. To avoid
  // double-counting on the heir boxes, subtract the cumulative past-gift
  // amount per trust from the OOE entity amount used for attribution. The
  // *display* `outOfEstate` is unaffected — it keeps the full year-aware
  // figure. When no projection is provided (fixture tests), the year-aware
  // composition is bypassed and OOE balances are static, so no subtraction
  // is needed.
  const ooeForAttribution: EstateFlowSummary["outOfEstate"] = input.projection
    ? subtractPastGiftsForAttribution(outOfEstate, input.gifts, input.asOfYear, clientData)
    : outOfEstate;

  // Per-heir composition. Rule 1 populates `outright` from at-death receipts;
  // rule 2 attributes trust bequests to the trust's beneficiaries as `inTrust`;
  // rule 3 attributes OOE balances (529 plans → outright, irrevocable trusts →
  // inTrust); rules 4-5 attribute lifetime gifts (person → outright,
  // trust → inTrust via beneficiary weights).
  const heirAcc = new Map<string, HeirAccumulator>();
  const sectionsByHeir = new Map<string, HeirSectionAccumulator>();
  collectAtDeathOutright(heirAcc, sectionsByHeir, reportData.firstDeath, "firstDeath");
  collectAtDeathOutright(heirAcc, sectionsByHeir, reportData.secondDeath, "secondDeath");
  collectTrustBequestsInTrust(heirAcc, sectionsByHeir, reportData.firstDeath, clientData);
  collectTrustBequestsInTrust(heirAcc, sectionsByHeir, reportData.secondDeath, clientData);
  collectOoeAttribution(heirAcc, sectionsByHeir, ooeForAttribution, clientData);
  collectLifetimeGifts(heirAcc, sectionsByHeir, input.gifts, clientData);
  const heirBoxes = finalizeHeirBoxes(
    heirAcc,
    sectionsByHeir,
    reportData.firstDeath?.decedentName ?? null,
    reportData.secondDeath?.decedentName ?? null,
  );

  // Value-conservation roll-ups for the Overview header.
  //   totalTaxesAndExpenses = Σ reductions across both deaths (signed; the
  //     report stores admin/IRD/estate-tax draws as negatives so this stays
  //     consistent with the per-death taxes sub-box totals).
  //   totalToHeirs        = Σ heirBoxes.total (which itself == outright +
  //     inTrust per box, locked by tests in this file).
  const totalTaxesAndExpenses =
    (reportData.firstDeath?.reductions ?? []).reduce(
      (s, r) => s + r.amount,
      0,
    ) +
    (reportData.secondDeath?.reductions ?? []).reduce(
      (s, r) => s + r.amount,
      0,
    );
  const totalToHeirs = heirBoxes.reduce((s, h) => s + h.total, 0);

  return {
    survivorNetWorth,
    firstDeath,
    secondDeath,
    outOfEstate,
    heirBoxes,
    totals: { totalTaxesAndExpenses, totalToHeirs },
  };
}
