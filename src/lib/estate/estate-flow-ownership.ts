import type { Account, ClientData, Will } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  type AccountOwner,
  controllingFamilyMember,
  controllingEntity,
  ownedByFamilyMember,
  ownedByEntity,
} from "@/engine/ownership";
import type { EstateFlowGift } from "./estate-flow-gifts";
import { resolveOwnerSlices } from "./account-owner-slices";
import {
  isPolicyInForce,
  insuredRetirementYearFor,
  resolveOwnerRetirementYears,
} from "./insurance-in-force";

// ── Output Types ─────────────────────────────────────────────────────────────

export interface OwnershipAssetRow {
  /** Account id. */
  accountId: string;
  /** Row provenance — kept for forward-compat. All rows are now "account". */
  rowKind: "account";
  /** True for auto-provisioned default-checking accounts (household + entity cash).
   *  Such rows are not clickable to retitle. */
  isDefaultCash: boolean;
  name: string;
  /** Account category (e.g. "taxable", "retirement", "real_estate"). */
  accountType: string;
  /** Fractional value if split; full value if sole owner. */
  value: number;
  /** This group's ownership fraction (1 = whole). */
  percent: number;
  isSplit: boolean;
  linkedLiabilities: { liabilityId: string; name: string; balance: number }[];
  /** value minus linked liability balances (at this group's fractional share). */
  netValue: number;
  hasBeneficiaries: boolean;
  /** No beneficiary AND no will provision (specific bequest or residuary clause). */
  hasConflict: boolean;
  /** Asset-once gifts dated after the current as-of year that will move this asset out. */
  futureGifts?: { giftId: string; year: number; percent: number }[];
}

export interface OwnershipGroup {
  /** "client" | "spouse" | "joint" | `entity:<id>` */
  key: string;
  kind: "client" | "spouse" | "joint" | "trust";
  label: string;
  assets: OwnershipAssetRow[];
  /** Sum of netValue across all assets. */
  subtotal: number;
}

export interface OwnershipColumnData {
  groups: OwnershipGroup[];
  grandTotal: number;
}

export interface OwnershipColumnOptions {
  /** Live projection — required to read year-N account values. */
  projection?: ProjectionResult;
  /**
   * When set, values come from the projection's year-N state; default = today.
   * Should always be passed together with `projection`; passing `asOfYear`
   * without `projection` yields stale base values while still dropping ~0
   * rows / attaching markers.
   */
  asOfYear?: number;
  /**
   * The plan's first year ("today"). When `asOfYear` lands on or before this
   * year, column values come from the advisor-entered current balances rather
   * than the projection's end-of-year-N state — the projection's first year
   * already bakes in a full year of growth, contributions and withdrawals,
   * so reading its `endingValue` would overstate "today".
   */
  todayYear?: number;
  /** Working gift drafts — used to attach future-gift markers. */
  gifts?: EstateFlowGift[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Structural conflict check for column-1 (as-of-today, no death event).
 * An account has a conflict when it has no beneficiary designations AND
 * none of the household's wills either:
 *   (a) has a specific asset bequest naming this account, or
 *   (b) has a non-empty residuary clause.
 *
 * Note: we check all wills, not just the owner's will, because jointly held
 * accounts may be covered by either grantor's will.
 */
function hasWillProvision(accountId: string, wills: Will[]): boolean {
  for (const will of wills) {
    // (b) Non-empty residuary clause covers all residual assets.
    if (will.residuaryRecipients && will.residuaryRecipients.length > 0) {
      return true;
    }
    // (a) Asset bequest: all_assets covers every account; specific must match.
    for (const bequest of will.bequests) {
      if (bequest.kind === "asset") {
        if (bequest.assetMode === "all_assets") {
          return true;
        }
        if (bequest.assetMode === "specific" && bequest.accountId === accountId) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Build the linked-liability list for an account row, scoped to a specific owner.
 * The balance returned is already fractional (liability.balance × ownerPercent).
 */
function buildLinkedLiabilities(
  data: ClientData,
  accountId: string,
  ownerKind: "family_member" | "entity",
  ownerId: string,
): { liabilityId: string; name: string; balance: number }[] {
  return (data.liabilities ?? [])
    .filter((l) => l.linkedPropertyId === accountId)
    .flatMap((l) => {
      const liabPercent =
        ownerKind === "family_member"
          ? ownedByFamilyMember(l, ownerId)
          : ownedByEntity(l, ownerId);
      if (liabPercent <= 0) return [];
      return [
        {
          liabilityId: l.id,
          name: l.name,
          balance: l.balance * liabPercent,
        },
      ];
    });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Builds the column-1 (as-of-today) ownership display structure from ClientData.
 *
 * Groups:
 *   - "client"  — accounts with a sole family_member owner whose role === "client"
 *   - "spouse"  — accounts with a sole family_member owner whose role === "spouse"
 *   - "client" + "spouse" — split fractional rows when both own a portion
 *   - "entity:<id>" — accounts 100% owned by a single entity (trust or business)
 *
 * Joint accounts (where both client and spouse each own a fraction) produce
 * fractional rows in both the Client and Spouse groups with isSplit: true.
 * A dedicated "joint" group is omitted in v1 — only emitted when an owner
 * has kind === "entity" that represents a joint ownership entity (not modeled).
 *
 * Empty groups are dropped.
 */
export function buildOwnershipColumn(
  data: ClientData,
  options: OwnershipColumnOptions = {},
): OwnershipColumnData {
  const wills = data.wills ?? [];
  const entities = data.entities ?? [];

  /**
   * Resolve an account's value as of the requested year. When both an
   * `asOfYear` and a `projection` are supplied, the projection's year-N
   * ending value wins; otherwise the advisor-entered base value is used.
   *
   * The "today" column (`asOfYear` on or before `todayYear`) is exempt: it
   * shows current balances, so it keeps the base values and never reads a
   * projected `endingValue`.
   */
  const isTodayColumn =
    options.asOfYear !== undefined &&
    options.todayYear !== undefined &&
    options.asOfYear <= options.todayYear;
  const yearState =
    options.asOfYear !== undefined && options.projection && !isTodayColumn
      ? options.projection.years.find((y) => y.year === options.asOfYear)
      : undefined;
  const resolveValue = (accountId: string, baseValue: number): number => {
    return yearState?.accountLedgers[accountId]?.endingValue ?? baseValue;
  };

  const displayYear =
    options.asOfYear ?? options.todayYear ?? new Date().getFullYear();

  const { clientRetirementYear, spouseRetirementYear } = resolveOwnerRetirementYears(
    data.client,
  );

  /**
   * Insurance policies show their face value (death benefit) in the Ownership
   * column when in force, falling back to the cash-value `resolveValue` for
   * lapsed term / post-retirement policies. Non-insurance accounts return
   * `resolveValue` unchanged — purely additive behavior.
   */
  const displayValueFor = (account: Account, projected: number): number => {
    if (account.category !== "life_insurance" || !account.lifeInsurance) {
      return projected;
    }
    const retYear = insuredRetirementYearFor(
      account,
      clientRetirementYear,
      spouseRetirementYear,
    );
    return isPolicyInForce(account, displayYear, retYear)
      ? account.lifeInsurance.faceValue
      : projected;
  };

  /**
   * Asset-once gifts dated strictly after the as-of year that will move
   * (part of) this account out. Empty unless `asOfYear` is set.
   */
  const futureGiftsFor = (
    accountId: string,
  ): { giftId: string; year: number; percent: number }[] => {
    if (options.asOfYear === undefined) return [];
    return (options.gifts ?? [])
      .filter(
        (g): g is Extract<EstateFlowGift, { kind: "asset-once" }> =>
          g.kind === "asset-once" &&
          g.accountId === accountId &&
          g.year > options.asOfYear!,
      )
      .map((g) => ({ giftId: g.id, year: g.year, percent: g.percent }));
  };

  const familyMembers = data.familyMembers ?? [];
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");

  const clientFmId = clientFm?.id ?? null;
  const spouseFmId = spouseFm?.id ?? null;

  const clientLabel = clientFm?.firstName ?? data.client.firstName ?? "Client";
  const spouseLabel = spouseFm?.firstName ?? data.client.spouseName ?? "Spouse";

  const entityGroups = new Map<string, OwnershipGroup>();
  for (const entity of entities) {
    // Business accounts live in `data.accounts` (business-as-asset model) and
    // are picked up by the per-account loop below. Trust groups start empty
    // and gather the accounts they own as that loop runs.
    entityGroups.set(entity.id, {
      key: `entity:${entity.id}`,
      kind: "trust",
      label: entity.name ?? entity.id,
      assets: [],
      subtotal: 0,
    });
  }

  const clientGroup: OwnershipGroup = {
    key: "client",
    kind: "client",
    label: clientLabel,
    assets: [],
    subtotal: 0,
  };
  const spouseGroup: OwnershipGroup = {
    key: "spouse",
    kind: "spouse",
    label: spouseLabel,
    assets: [],
    subtotal: 0,
  };

  for (const account of data.accounts) {
    const accountId = account.id;
    const hasBeneficiaries = (account.beneficiaries ?? []).length > 0;
    const willProvision = hasWillProvision(accountId, wills);
    const hasConflict = !hasBeneficiaries && !willProvision;

    const soloEntityId = controllingEntity(account);
    if (soloEntityId !== null) {
      let group = entityGroups.get(soloEntityId);
      if (!group) {
        // Entity id not found in data.entities — emit an orphan group so the
        // account value is not silently dropped from grandTotal.
        group = {
          key: `entity:${soloEntityId}`,
          // Entity type is unknown here; default to "trust" — the only valid
          // entity kind after the business-as-asset migration. The rendering
          // layer should treat this as a data-quality fallback, not a
          // deterministic label.
          kind: "trust",
          label: "Unknown entity",
          assets: [],
          subtotal: 0,
        };
        entityGroups.set(soloEntityId, group);
      }
      const linkedLiabilities = buildLinkedLiabilities(data, accountId, "entity", soloEntityId);
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const resolvedValue = displayValueFor(account, resolveValue(accountId, account.value));
      const netValue = resolvedValue - liabilityTotal;
      const futureGifts = futureGiftsFor(accountId);
      group.assets.push({
        accountId,
        rowKind: "account",
        isDefaultCash: account.isDefaultChecking === true,
        name: account.name,
        accountType: account.category,
        value: resolvedValue,
        percent: 1,
        isSplit: false,
        linkedLiabilities,
        netValue,
        hasBeneficiaries,
        hasConflict,
        ...(futureGifts.length > 0 ? { futureGifts } : {}),
      });
      continue;
    }

    const soloFmId = controllingFamilyMember(account);
    if (soloFmId !== null) {
      const isClient = soloFmId === clientFmId;
      const isSpouse = soloFmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (targetGroup) {
        const ownerKind = "family_member" as const;
        const linkedLiabilities = buildLinkedLiabilities(data, accountId, ownerKind, soloFmId);
        const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
        const resolvedValue = displayValueFor(account, resolveValue(accountId, account.value));
        const netValue = resolvedValue - liabilityTotal;
        const futureGifts = futureGiftsFor(accountId);
        targetGroup.assets.push({
          accountId,
          rowKind: "account",
          isDefaultCash: account.isDefaultChecking === true,
          name: account.name,
          accountType: account.category,
          value: resolvedValue,
          percent: 1,
          isSplit: false,
          linkedLiabilities,
          netValue,
          hasBeneficiaries,
          hasConflict,
          ...(futureGifts.length > 0 ? { futureGifts } : {}),
        });
      }
      continue;
    }

    // Mixed ownership — emit fractional rows for each family-member owner.
    // This handles the split (e.g. 60/40 client/spouse) case.
    //
    // Slice resolution: an entity's slice uses its locked EoY share so a
    // household drawdown on the joint account doesn't bleed into the
    // business's portion; the family-member owners absorb the residual. In
    // the as-of-today view (no projected year state) this reduces to the
    // authored percent × value. Mirrors the gross-estate and balance-sheet
    // reports — see resolveOwnerSlices.
    const accountValueForSlicing = displayValueFor(
      account,
      resolveValue(accountId, account.value),
    );
    const slices = resolveOwnerSlices(
      accountId,
      account.owners,
      accountValueForSlicing,
      yearState?.entityAccountSharesEoY,
      yearState?.familyAccountSharesEoY,
    );
    const sliceValueOf = (owner: AccountOwner): number =>
      slices.find((s) => s.owner === owner)?.value ?? 0;

    const ownerRows = account.owners.filter(
      (o): o is Extract<AccountOwner, { kind: "family_member" }> => o.kind === "family_member",
    );
    const hasMultipleFmOwners = ownerRows.length > 1;

    for (const ownerRow of ownerRows) {
      const fmId = ownerRow.familyMemberId;
      const percent = ownerRow.percent;
      if (percent <= 0) continue;

      const isClient = fmId === clientFmId;
      const isSpouse = fmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (!targetGroup) continue;

      const linkedLiabilities = buildLinkedLiabilities(data, accountId, "family_member", fmId);
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const fractionalValue = sliceValueOf(ownerRow);
      const netValue = fractionalValue - liabilityTotal;
      const futureGifts = futureGiftsFor(accountId);

      targetGroup.assets.push({
        accountId,
        rowKind: "account",
        isDefaultCash: account.isDefaultChecking === true,
        name: account.name,
        accountType: account.category,
        value: fractionalValue,
        percent,
        isSplit: hasMultipleFmOwners,
        linkedLiabilities,
        netValue,
        hasBeneficiaries,
        hasConflict,
        ...(futureGifts.length > 0 ? { futureGifts } : {}),
      });
    }

    // Entity owners on a mixed account — emit a fractional row into the
    // entity's group. Mirrors the family-member rows above. Without this an
    // entity's partial slice of a mixed account is dropped from the column.
    // (Canonical rule: a business entity's value includes its partial slices
    // of mixed accounts.) Uses the same locked-share slice resolution as the
    // family rows above so the two sides always sum to the account balance.
    const entityOwnerRows = account.owners.filter(
      (o): o is Extract<AccountOwner, { kind: "entity" }> => o.kind === "entity",
    );
    for (const ownerRow of entityOwnerRows) {
      const percent = ownerRow.percent;
      if (percent <= 0) continue;

      let group = entityGroups.get(ownerRow.entityId);
      if (!group) {
        group = {
          key: `entity:${ownerRow.entityId}`,
          kind: "trust",
          label: "Unknown entity",
          assets: [],
          subtotal: 0,
        };
        entityGroups.set(ownerRow.entityId, group);
      }

      const linkedLiabilities = buildLinkedLiabilities(
        data,
        accountId,
        "entity",
        ownerRow.entityId,
      );
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const fractionalValue = sliceValueOf(ownerRow);
      const netValue = fractionalValue - liabilityTotal;
      const futureGifts = futureGiftsFor(accountId);

      group.assets.push({
        accountId,
        rowKind: "account",
        isDefaultCash: account.isDefaultChecking === true,
        name: account.name,
        accountType: account.category,
        value: fractionalValue,
        percent,
        isSplit: true, // mixed account → always a split
        linkedLiabilities,
        netValue,
        hasBeneficiaries,
        hasConflict,
        ...(futureGifts.length > 0 ? { futureGifts } : {}),
      });
    }
  }

  // When viewing a projected year, drop any asset whose resolved value has
  // gone to ~0 (e.g. fully gifted away) so it no longer occupies a row.
  const dropZeroed = options.asOfYear !== undefined;

  const allGroups: OwnershipGroup[] = [clientGroup, spouseGroup, ...entityGroups.values()];
  const nonEmptyGroups = allGroups
    .map((g) => {
      const assets = dropZeroed
        ? g.assets.filter((a) => Math.abs(a.value) >= 1)
        : g.assets;
      // Recompute the subtotal from the surviving rows so totals stay consistent.
      return { ...g, assets, subtotal: assets.reduce((s, a) => s + a.netValue, 0) };
    })
    .filter((g) => g.assets.length > 0);

  const grandTotal = nonEmptyGroups.reduce((s, g) => s + g.subtotal, 0);

  return { groups: nonEmptyGroups, grandTotal };
}
