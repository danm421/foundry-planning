export type RecipientKind = "family_member" | "external_beneficiary" | "entity" | "spouse";

export interface AccountInfo { name: string; category: string; subType?: string }
export interface ModelPortfolioInfo { name: string; rate: number }
export interface AllocationInfo { mix: string; blendedRate: number }

/**
 * Projection-derived figures for a buy/sell asset transaction, keyed by the
 * transaction id. Sourced from `ProjectionYear.techniqueBreakdown`. Lets the
 * asset_transaction describer show the actual value bought/sold and the net
 * cash received — neither of which lives in the raw scenario-change payload
 * (the sale value is a projected market value; net proceeds net out costs,
 * mortgage payoff, and the home-sale exclusion). Fields are optional so a
 * partial/skipped breakdown degrades gracefully.
 */
export interface AssetTxInfo {
  type: "buy" | "sell";
  // sell
  saleValue?: number;
  netProceeds?: number;
  capitalGain?: number;
  transactionCosts?: number;
  mortgagePaidOff?: number;
  // buy
  purchasePrice?: number;
  mortgageAmount?: number;
  equity?: number;
}

/** Plain serializable maps assembled server-side and injected via the context. */
export interface ResolveContextData {
  accountsById: Record<string, AccountInfo>;
  /** keyed `${recipientKind}:${id}` → display name */
  recipientsById: Record<string, string>;
  entitiesById: Record<string, string>;
  spouseName: string | null;
  /** reinvestment enrichment — empty unless a reinvestment change exists */
  modelPortfoliosById: Record<string, ModelPortfolioInfo>;
  baseAllocationsById: Record<string, AllocationInfo>;
  /** asset-transaction enrichment — projection-derived figures keyed by
   *  transaction id. Optional so pre-existing callers (and tests) that don't
   *  supply it keep compiling; absent → describer falls back to payload values. */
  assetTxById?: Record<string, AssetTxInfo>;
}

export const EMPTY_RESOLVE_DATA: ResolveContextData = {
  accountsById: {}, recipientsById: {}, entitiesById: {},
  spouseName: null, modelPortfoliosById: {}, baseAllocationsById: {},
  assetTxById: {},
};

export interface ResolveContext {
  accountName: (id: string | null | undefined) => string;
  accountInfo: (id: string | null | undefined) => AccountInfo | null;
  recipientName: (kind: RecipientKind, id: string | null | undefined) => string;
  entityName: (id: string | null | undefined) => string;
  modelPortfolio: (id: string | null | undefined) => ModelPortfolioInfo | null;
  baseAllocation: (id: string | null | undefined) => AllocationInfo | null;
  assetTx: (id: string | null | undefined) => AssetTxInfo | null;
}

export function buildResolveContext(d: ResolveContextData): ResolveContext {
  return {
    accountName: (id) => (id && d.accountsById[id]?.name) || "an account",
    accountInfo: (id) => (id && d.accountsById[id]) || null,
    recipientName: (kind, id) => {
      if (kind === "spouse") return d.spouseName ?? "spouse";
      return (id && d.recipientsById[`${kind}:${id}`]) || "a recipient";
    },
    entityName: (id) => (id && d.entitiesById[id]) || "an entity",
    modelPortfolio: (id) => (id && d.modelPortfoliosById[id]) || null,
    baseAllocation: (id) => (id && d.baseAllocationsById[id]) || null,
    assetTx: (id) => (id && d.assetTxById?.[id]) || null,
  };
}
