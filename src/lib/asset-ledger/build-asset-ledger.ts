// src/lib/asset-ledger/build-asset-ledger.ts
import type { AccountLedger, ProjectionYear } from "@/engine/types";
import type { AssetAccountBlock, AssetLedger, AssetLedgerContext, AssetOwnerSection, AssetRow } from "./types";

const HOUSEHOLD_ID = "household";
const RECONCILE_TOLERANCE = 1;

/** True for accounts with no balance and no activity — hidden entirely. */
function isEmpty(ledger: AccountLedger): boolean {
  return ledger.beginningValue === 0 && ledger.endingValue === 0 && ledger.entries.length === 0;
}

function buildBlock(id: string, ledger: AccountLedger, ctx: AssetLedgerContext): AssetAccountBlock {
  const rows: AssetRow[] = ledger.entries.map((e) => ({
    category: e.category,
    label: e.label,
    amount: e.amount,
    sourceId: e.sourceId,
    internal: e.isInternalTransfer ?? false,
  }));
  const sumRows = rows.reduce((s, r) => s + r.amount, 0);
  const residual = ledger.endingValue - ledger.beginningValue - sumRows;
  return {
    id,
    name: ctx.accountNames[id] ?? id,
    category: ctx.accountCategories[id] ?? "—",
    beginningValue: ledger.beginningValue,
    endingValue: ledger.endingValue,
    netChange: ledger.endingValue - ledger.beginningValue,
    summary: {
      growth: ledger.growth,
      contributions: ledger.contributions,
      distributions: ledger.distributions,
      rmd: ledger.rmdAmount,
      fees: ledger.fees,
      internalContributions: ledger.internalContributions,
      internalDistributions: ledger.internalDistributions,
    },
    rows,
    residual,
    reconciles: Math.abs(residual) <= RECONCILE_TOLERANCE,
  };
}

/** Order accounts within a section by category, then name. */
function byCategoryThenName(a: AssetAccountBlock, b: AssetAccountBlock): number {
  return a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category);
}

export function buildAssetLedger(year: ProjectionYear, ctx: AssetLedgerContext): AssetLedger {
  const household: AssetAccountBlock[] = [];
  // Preserve first-seen entity order for stable section ordering.
  const byEntity = new Map<string, AssetAccountBlock[]>();

  for (const [accountId, ledger] of Object.entries(year.accountLedgers)) {
    if (isEmpty(ledger)) continue;
    const block = buildBlock(accountId, ledger, ctx);
    const owner = ctx.accountEntityOwners.get(accountId);
    if (owner) {
      // Partial ownership (percent < 1): the account still lives under its entity
      // section; flows show at full ledger value (the ledger is the account's own,
      // not the owner's pro-rata share). Unknown entity ids fall through to a
      // section labeled with the raw id below — never silently dropped.
      const list = byEntity.get(owner.entityId) ?? [];
      list.push(block);
      byEntity.set(owner.entityId, list);
    } else {
      household.push(block);
    }
  }

  const sections: AssetOwnerSection[] = [];
  if (household.length > 0) {
    sections.push({ id: HOUSEHOLD_ID, label: "Household", kind: "household", accounts: household.sort(byCategoryThenName) });
  }
  for (const [entityId, blocks] of byEntity) {
    sections.push({
      id: entityId,
      label: ctx.entityNames[entityId] ?? entityId,
      kind: ctx.entityKinds[entityId] ?? "business",
      accounts: blocks.sort(byCategoryThenName),
    });
  }

  return { year: year.year, ages: year.ages, sections };
}
