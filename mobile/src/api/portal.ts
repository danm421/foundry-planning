// mobile/src/api/portal.ts
//
// Endpoint helpers for /api/portal/*. Contract types are imported
// type-only from @contracts (enforced by the mobile build).

import type {
  AccountsOverviewDTO, BudgetSummaryDTO, CategoryDetail,
  PlaidCommitDecision, PlaidItemAccountsDTO, PlaidItemDTO,
  PortalCategoryDTO, PortalDashboardDTO, PortalMeDTO, TransactionsPageDTO,
  PlaidLinkSuccessPayload, PlaidLinkTokenDTO,
} from "@contracts";
import { ForbiddenError, NonJsonResponseError, type ApiClient } from "./client";
import { buildTransactionsQuery, type TxnQuery } from "./query";

/** Signed in with Clerk, but not a bound portal client (advisor or unbound). */
export class NotPortalClientError extends Error {
  constructor() {
    super("not a portal client");
    this.name = "NotPortalClientError";
  }
}

export async function fetchMe(api: ApiClient): Promise<PortalMeDTO> {
  try {
    return await api.get<PortalMeDTO>("/api/portal/me");
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof NonJsonResponseError) {
      throw new NotPortalClientError();
    }
    throw e;
  }
}

export function fetchDashboard(api: ApiClient): Promise<PortalDashboardDTO> {
  return api.get<PortalDashboardDTO>("/api/portal/dashboard");
}

// ============================================================================
// Phase 2 — money screens (Accounts, Transactions, Budget)
// ============================================================================

export function fetchAccountsOverview(api: ApiClient): Promise<AccountsOverviewDTO> {
  return api.get<AccountsOverviewDTO>("/api/portal/accounts/overview");
}

export function fetchTransactions(api: ApiClient, params: TxnQuery): Promise<TransactionsPageDTO> {
  return api.get<TransactionsPageDTO>(`/api/portal/transactions${buildTransactionsQuery(params)}`);
}

export async function markReviewed(api: ApiClient, id: string, reviewed: boolean): Promise<void> {
  await api.put(`/api/portal/transactions/${id}`, { reviewed });
}

export function markAllReviewed(api: ApiClient): Promise<{ count: number }> {
  return api.post<{ ok: true; count: number }>("/api/portal/transactions/review-all", {})
    .then((r) => ({ count: r.count }));
}

export async function recategorize(api: ApiClient, id: string, categoryId: string | null): Promise<void> {
  await api.put(`/api/portal/transactions/${id}`, { categoryId });
}

export async function setExcluded(api: ApiClient, id: string, excluded: boolean): Promise<void> {
  await api.put(`/api/portal/transactions/${id}`, { excluded });
}

export function fetchCategories(api: ApiClient): Promise<PortalCategoryDTO[]> {
  return api.get<{ categories: PortalCategoryDTO[] }>("/api/portal/categories").then((r) => r.categories);
}

export function fetchBudgetSummary(api: ApiClient): Promise<BudgetSummaryDTO> {
  return api.get<BudgetSummaryDTO>("/api/portal/budgets");
}

export function fetchCategoryDetail(api: ApiClient, id: string): Promise<CategoryDetail> {
  return api.get<{ detail: CategoryDetail }>(`/api/portal/budgets/category/${id}`).then((r) => r.detail);
}

export async function setBudget(api: ApiClient, categoryId: string, monthlyAmount: number | null): Promise<void> {
  await api.put("/api/portal/budgets", { categoryId, monthlyAmount });
}

// ============================================================================
// Phase 3 — Plaid linking (mobile)
// ============================================================================

export type LinkTokenRequest = { itemId?: string; enableProducts?: boolean; accountSelection?: boolean };

export function createLinkToken(api: ApiClient, body: LinkTokenRequest): Promise<PlaidLinkTokenDTO> {
  return api.post<PlaidLinkTokenDTO>("/api/portal/plaid/link-token", body);
}

export function exchangePublicToken(
  api: ApiClient, args: { publicToken: string; institution?: { id?: string; name?: string } },
): Promise<PlaidLinkSuccessPayload> {
  return api.post<PlaidLinkSuccessPayload>("/api/portal/plaid/exchange", args);
}

export function commitExchange(
  api: ApiClient, args: { itemId: string; decisions: PlaidCommitDecision[] },
): Promise<{ ok: true; linkedAccountIds: string[] }> {
  return api.post("/api/portal/plaid/exchange/commit", args);
}

export function fetchPlaidItems(api: ApiClient): Promise<PlaidItemDTO[]> {
  return api.get<{ items: PlaidItemDTO[] }>("/api/portal/plaid/items").then((r) => r.items);
}

export function fetchItemAccounts(api: ApiClient, itemId: string): Promise<PlaidItemAccountsDTO> {
  return api.get<PlaidItemAccountsDTO>(`/api/portal/plaid/items/${itemId}/accounts`);
}

export function refreshItem(api: ApiClient, itemId: string): Promise<unknown> {
  return api.post(`/api/portal/plaid/items/${itemId}/refresh`, {});
}

export function reauthComplete(api: ApiClient, itemId: string): Promise<unknown> {
  return api.post(`/api/portal/plaid/items/${itemId}/reauth-complete`, {});
}

export function syncItem(api: ApiClient, itemId: string): Promise<unknown> {
  return api.post(`/api/portal/plaid/items/${itemId}/sync`, {});
}

export function unlinkItem(api: ApiClient, itemId: string): Promise<{ ok: true; detachedCount: number }> {
  return api.delete(`/api/portal/plaid/items/${itemId}`);
}

export function detachAccount(api: ApiClient, itemId: string, plaidAccountId: string): Promise<unknown> {
  return api.delete(`/api/portal/plaid/items/${itemId}/accounts/${plaidAccountId}`);
}

export function dismissNewAccounts(api: ApiClient, itemId: string): Promise<unknown> {
  return api.post(`/api/portal/plaid/items/${itemId}/dismiss-new-accounts`, {});
}

// ============================================================================
// Phase 4 — push notifications
// ============================================================================

export async function registerPushToken(
  api: ApiClient,
  input: { expoPushToken: string; platform: "ios" | "android"; enabled: boolean },
): Promise<void> {
  await api.post("/api/portal/push-tokens", input);
}

export async function deletePushToken(api: ApiClient, expoPushToken: string): Promise<void> {
  await api.delete(`/api/portal/push-tokens?token=${encodeURIComponent(expoPushToken)}`);
}
