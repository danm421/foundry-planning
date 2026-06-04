export type RecipientKind = "family_member" | "external_beneficiary" | "entity" | "spouse";

export interface AccountInfo { name: string; category: string; subType?: string }
export interface ModelPortfolioInfo { name: string; rate: number }
export interface AllocationInfo { mix: string; blendedRate: number }

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
}

export const EMPTY_RESOLVE_DATA: ResolveContextData = {
  accountsById: {}, recipientsById: {}, entitiesById: {},
  spouseName: null, modelPortfoliosById: {}, baseAllocationsById: {},
};

export interface ResolveContext {
  accountName: (id: string | null | undefined) => string;
  accountInfo: (id: string | null | undefined) => AccountInfo | null;
  recipientName: (kind: RecipientKind, id: string | null | undefined) => string;
  entityName: (id: string | null | undefined) => string;
  modelPortfolio: (id: string | null | undefined) => ModelPortfolioInfo | null;
  baseAllocation: (id: string | null | undefined) => AllocationInfo | null;
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
  };
}
