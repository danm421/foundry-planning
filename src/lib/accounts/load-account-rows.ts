// src/lib/accounts/load-account-rows.ts
//
// The complete per-account row the Net Worth page and the Household Map both
// render from. Built by merging the SCENARIO-EFFECTIVE engine accounts with
// base-scoped view-only metadata overlaid for the active scenario
// (`loadOverlaidAccountMeta`).
//
// This merge is the only place an account's `growthSource` / `modelPortfolioId`
// and the engine's RESOLVED `growthRate` appear together. `accountEngineToView`
// (lib/scenario/view-adapters.ts) is a documented PARTIAL that drops the meta
// columns — it is not a substitute and stays as-is.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";
import type { AccountMeta } from "@/lib/scenario/account-meta";
import type { AccountRow, LinkedSource } from "@/components/balance-sheet-view";

export type AccountMetaRow = Awaited<ReturnType<typeof loadAccountMetaRows>>[number];

/** Base-scoped metadata select. Scenario overlay happens separately via
 *  `loadOverlaidAccountMeta`, which expects exactly these columns. */
export async function loadAccountMetaRows(clientId: string, baseScenarioId: string) {
  return db
    .select({
      id: accounts.id,
      growthSource: accounts.growthSource,
      modelPortfolioId: accounts.modelPortfolioId,
      tickerPortfolioId: accounts.tickerPortfolioId,
      turnoverPct: accounts.turnoverPct,
      overridePctOi: accounts.overridePctOi,
      overridePctLtCg: accounts.overridePctLtCg,
      overridePctQdiv: accounts.overridePctQdiv,
      overridePctTaxExempt: accounts.overridePctTaxExempt,
      annualPropertyTax: accounts.annualPropertyTax,
      propertyTaxGrowthRate: accounts.propertyTaxGrowthRate,
      propertyTaxGrowthSource: accounts.propertyTaxGrowthSource,
      countsTowardAum: accounts.countsTowardAum,
      source: accounts.source,
      plaidItemId: accounts.plaidItemId,
      externalProvider: accounts.externalProvider,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, baseScenarioId)));
}

/** `plaidItemId` is the reliable Plaid signal — the `source` enum can lag until
 *  holdings ingest. Base-scoped, so scenario-added accounts correctly read as
 *  manual with no badge. */
export function linkedSourceMapFrom(rows: AccountMetaRow[]): Map<string, LinkedSource> {
  const out = new Map<string, LinkedSource>();
  for (const r of rows) {
    if (r.plaidItemId != null) out.set(r.id, "plaid");
    else if (r.externalProvider === "orion" || r.source === "orion") out.set(r.id, "orion");
  }
  return out;
}

export interface BuildAccountRowsArgs {
  /** `effectiveTree.accounts` — scenario applied, growthRate already resolved. */
  accounts: readonly EngineAccountLike[];
  /** `effectiveTree.familyMembers` — serves BOTH owner-key resolution
   *  (client/spouse) and the 529 beneficiary display name. Pre-extraction the
   *  beneficiary lookup read a separate, base-scoped `familyMembers` query
   *  instead; consolidating both onto this single scenario-effective list is
   *  deliberate (the page is scenario-effective throughout), and means a
   *  scenario that renames or adds a 529 beneficiary now shows the
   *  scenario-effective name, not the base one. */
  familyMembers: readonly { id: string; role: string; firstName: string; lastName?: string | null }[];
  accountMetaById: ReadonlyMap<string, AccountMeta>;
  linkedSourceById: ReadonlyMap<string, LinkedSource>;
}

/** Structural stand-in for the engine `Account`. Declared locally so this
 *  module does not import engine types into a lib that pages consume. */
type EngineAccountLike = Parameters<typeof controllingEntity>[0] & {
  id: string;
  name: string;
  category: string;
  subType: string;
  value: number;
  basis: number;
  rothValue?: number | null;
  hsaCoverage?: "self" | "family" | null;
  growthRate: number;
  rmdEnabled?: boolean | null;
  priorYearEndValue?: number | null;
  isDefaultChecking?: boolean;
  owners?: AccountRow["owners"];
  titlingType?: AccountRow["titlingType"];
  parentAccountId?: string | null;
  education529?: {
    grantorFamilyMemberId?: string | null;
    grantorName?: string | null;
    beneficiaryFamilyMemberId?: string | null;
    beneficiaryName?: string | null;
    rothRolloverEnabled?: boolean;
    rothRolloverStartYear?: number | null;
    rothRolloverAccountId?: string | null;
  };
};

export function buildAccountRows({
  accounts: engineAccounts,
  familyMembers,
  accountMetaById,
  linkedSourceById,
}: BuildAccountRowsArgs): AccountRow[] {
  const clientFmId = familyMembers.find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = familyMembers.find((fm) => fm.role === "spouse")?.id ?? null;

  const ownerKeyOf = (acct: EngineAccountLike): string => {
    const cfm = controllingFamilyMember(acct);
    if (cfm === spouseFmId && spouseFmId != null) return "spouse";
    if (cfm === clientFmId && clientFmId != null) return "client";
    return "joint";
  };

  const beneficiaryDisplayNameFor = (
    edu: EngineAccountLike["education529"],
  ): string | null => {
    if (!edu) return null;
    if (edu.beneficiaryFamilyMemberId) {
      const fm = familyMembers.find((m) => m.id === edu.beneficiaryFamilyMemberId);
      if (fm) return `${fm.firstName}${fm.lastName ? ` ${fm.lastName}` : ""}`;
    }
    return edu.beneficiaryName ?? null;
  };

  return engineAccounts.map((a) => {
    const meta = accountMetaById.get(a.id);
    return {
      id: a.id,
      name: a.name,
      category: a.category as AccountRow["category"],
      subType: a.subType,
      owner: ownerKeyOf(a),
      value: String(a.value),
      basis: String(a.basis),
      linkedSource: linkedSourceById.get(a.id) ?? null,
      rothValue: a.rothValue != null ? String(a.rothValue) : null,
      hsaCoverage: a.hsaCoverage ?? null,
      growthRate: a.growthRate == null ? null : String(a.growthRate),
      rmdEnabled: a.rmdEnabled ?? null,
      priorYearEndValue: a.priorYearEndValue != null ? String(a.priorYearEndValue) : null,
      ownerEntityId: controllingEntity(a) ?? null,
      // From meta, not from `a` — the engine Account type never carries these.
      countsTowardAum: meta?.countsTowardAum ?? false,
      growthSource: meta?.growthSource ?? "default",
      modelPortfolioId: meta?.modelPortfolioId ?? null,
      tickerPortfolioId: meta?.tickerPortfolioId ?? null,
      turnoverPct: meta?.turnoverPct == null ? null : String(meta.turnoverPct),
      overridePctOi: meta?.overridePctOi == null ? null : String(meta.overridePctOi),
      overridePctLtCg: meta?.overridePctLtCg == null ? null : String(meta.overridePctLtCg),
      overridePctQdiv: meta?.overridePctQdiv == null ? null : String(meta.overridePctQdiv),
      overridePctTaxExempt:
        meta?.overridePctTaxExempt == null ? null : String(meta.overridePctTaxExempt),
      annualPropertyTax: meta?.annualPropertyTax == null ? null : String(meta.annualPropertyTax),
      propertyTaxGrowthRate:
        meta?.propertyTaxGrowthRate == null ? null : String(meta.propertyTaxGrowthRate),
      propertyTaxGrowthSource: meta?.propertyTaxGrowthSource ?? "custom",
      isDefaultChecking: a.isDefaultChecking ?? false,
      owners: a.owners,
      titlingType: a.titlingType,
      parentAccountId: a.parentAccountId ?? null,
      grantorFamilyMemberId: a.education529?.grantorFamilyMemberId ?? null,
      grantorName: a.education529?.grantorName ?? null,
      beneficiaryFamilyMemberId: a.education529?.beneficiaryFamilyMemberId ?? null,
      beneficiaryName: a.education529?.beneficiaryName ?? null,
      rothRolloverEnabled: a.education529?.rothRolloverEnabled ?? false,
      rothRolloverStartYear: a.education529?.rothRolloverStartYear ?? null,
      rothRolloverAccountId: a.education529?.rothRolloverAccountId ?? null,
      beneficiaryDisplayName: beneficiaryDisplayNameFor(a.education529),
    };
  });
}
