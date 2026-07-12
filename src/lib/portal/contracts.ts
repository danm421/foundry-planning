// src/lib/portal/contracts.ts
//
// Wire types for /api/portal/* responses, shared with the mobile app
// (mobile/), which imports this file TYPE-ONLY via its `@contracts`
// tsconfig path. HARD RULE: types/interfaces only — a single value
// import or export here breaks the mobile build. The web-side modules
// these types moved out of import them back and re-export, so existing
// imports keep working.

// ---- actor + privacy (from resolve-portal-client.ts / privacy.ts) ----
export type PortalActorMode = "client" | "advisor";

export interface PortalPrivacy {
  shareTransactions: boolean;
  shareBudgets: boolean;
  shareRecurrings: boolean;
}

// ---- dashboard tile primitives (from dashboard-summary.ts) ----
export interface PacePoint {
  day: number;
  cumulative: number;
  pace: number;
}

export interface DueRecurring {
  id: string;
  name: string;
  cadence: "monthly" | "annually";
  predicted: number;
  state: "paid" | "due" | "overdue";
  dueDate: string;
  daysUntil: number;
  postedThisMonth: number;
}

export interface TopCategory {
  id: string;
  name: string;
  color: string;
  spent: number;
  budget: number | null;
}

// ---- net-worth trend (from networth-trend.ts) ----
export interface TrendPoint {
  date: string;
  netWorth: number;
}

// ---- recurring rows (from recurring-matching.ts) ----
export type RecurringRowDTO = {
  id: string;
  name: string;
  cadence: "monthly" | "annually";
  dueDay: number | null;
  dueMonth: number | null;
  matchType: "exact" | "contains";
  pattern: string;
  amountMin: number;
  amountMax: number;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  predicted: number;
  state: "paid" | "due" | "overdue";
  postedThisMonth: number;
  nextPaymentDate: string | null;
  timeline: { month: string; paid: boolean }[];
  metricsByYear: { year: number; total: number; avg: number; count: number }[];
};

// ---- dashboard DTO (from load-dashboard.ts) ----
export interface ReviewTxn {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: number;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

/** One row of the net-worth drill-down (visible asset account or debt). */
export interface NetWorthLine {
  id: string;
  name: string;
  value: number;
}

/** One budget group for the spending drill-down. */
export interface SpendingGroupLine {
  id: string;
  name: string;
  color: string;
  spent: number;
  budget: number | null;
}

export interface PortalDashboardDTO {
  spending: {
    left: number;
    budgeted: number;
    spent: number;
    pace: PacePoint[];
    underBy: number;
    month: string;
    groups: SpendingGroupLine[];
  };
  netWorth: {
    assets: number;
    debt: number;
    netWorth: number;
    series: TrendPoint[];
    asOfDate: string;
    accounts: NetWorthLine[];
    debts: NetWorthLine[];
  };
  toReview: { count: number; sample: ReviewTxn[] };
  topCategories: TopCategory[];
  netThisMonth: {
    net: number;
    income: number;
    spent: number;
    prior: number;
    deltaAbs: number;
    deltaPct: number | null;
  };
  recurrings: DueRecurring[];
  /** Full recurring rows so the drill-down can reuse RecurringDetailPanel. */
  recurringRows: RecurringRowDTO[];
  /**
   * The client's advisor-sharing switches. All-true on the client's own
   * portal. In advisor preview, switched-off sections are never queried (they
   * come back zeroed) and the grid shows a NotSharedNotice tile instead.
   */
  sharing: PortalPrivacy;
}

// ---- GET /api/portal/me ----
export interface PortalMeDTO {
  client: { id: string; displayName: string; email: string };
  firm: { name: string; logoUrl: string | null };
  mode: PortalActorMode;
  /** clients.portalEditEnabled — mobile gates review/recategorize/exclude/budget-edit on this. */
  editEnabled: boolean;
}

// ============================================================================
// Phase 2 — money screens (Accounts, Transactions, Budget). All wire types.
// ============================================================================

// ---- accounts overview (GET /api/portal/accounts/overview) ----
// NetWorthSummary + PortalDebtRow MOVED here from portal-networth.ts.
export interface NetWorthSummary {
  assets: number;
  debt: number;
  netWorth: number;
}

export interface PortalDebtRow {
  id: string;
  name: string;
  /** Household-share-applied balance (what the row displays). */
  balance: number;
  /** Full stored balance, unscaled. */
  rawBalance: number;
  liabilityType: string | null;
  aprPercentage: number | null;
  statementBalance: number | null;
  minimumPayment: number | null;
  nextPaymentDueDate: string | null;
  isPlaidLinked: boolean;
  ownerFmIds: string[];
  ownerEntityIds: string[];
}

export interface PortalAccountRow {
  id: string;
  name: string;
  category: string;
  subType: string;
  last4: string | null;
  value: number;
  isPlaidLinked: boolean;
}

export interface AccountsOverviewDTO {
  assets: PortalAccountRow[];
  debts: PortalDebtRow[];
  netWorth: NetWorthSummary;
}

// ---- transactions ----
// PortalTransactionDTO MOVED here from transactions-query.ts.
export type PortalTransactionDTO = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  /** Signed 2-dp string. Plaid convention: + = money OUT (spend), - = money IN. */
  amount: string;
  pending: boolean;
  excluded: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorizedBy: "plaid" | "rule" | "manual" | "recurring";
  accountId: string | null;
  accountName: string | null;
  accountMask: string | null;
  type: "income" | "expense" | "transfer";
  source: "plaid" | "manual";
  reviewed: boolean;
};

export interface TransactionsPageDTO {
  transactions: PortalTransactionDTO[];
  total: number;
  hasMore: boolean;
}

// ---- categories (GET /api/portal/categories) — the subset the picker reads ----
export interface PortalCategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  slug: string | null;
  /** var(--data-*) token; resolve to hex on mobile via data-color.ts. */
  color: string;
  kind: "group" | "category";
  sortOrder: number;
}

// ---- budget summary (GET /api/portal/budgets) ----
// LeafCell/GroupCell/BudgetSummary MOVED here from budget-summary.ts.
export type LeafCell = {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  budget: number | null;
  actual: number;
};

export type GroupCell = {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  budget: number | null;
  budgetIsExplicit: boolean;
  unallocated: number;
  actual: number;
  remaining: number | null;
  leaves: LeafCell[];
};

export type BudgetSummary = {
  groups: GroupCell[];
  totalBudget: number;
  totalSpent: number;
  totalRemaining: number;
  incomeThisMonth: number;
};

export type BudgetSummaryDTO = BudgetSummary & { month: string };

// ---- budget category detail (GET /api/portal/budgets/category/[id]) ----
// Heat/HistoryBar/YearMetric/CategoryTransaction/CategoryDetail MOVED here
// from category-detail.ts.
export type Heat = "good" | "warn" | "crit" | "none";
export type HistoryBar = { month: string; amount: number; heat: Heat };
export type YearMetric = { year: number; total: number; avgMonthly: number };
export type CategoryTransaction = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  /** signed; positive = spend. */
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string;
};
export type CategoryDetail = {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  emoji: string;
  kind: "group" | "category";
  monthlyBudget: number | null;
  spentThisMonth: number;
  remainingThisMonth: number | null;
  history: HistoryBar[];
  metrics: YearMetric[];
  transactions: CategoryTransaction[];
};

// ---- plaid items (GET /api/portal/plaid/items) ----
export interface PlaidItemDTO {
  id: string;
  institutionName: string | null;
  /** ISO string, or null if never refreshed. Mobile formats relative time. */
  lastRefreshedAt: string | null;
  needsReauth: boolean;
  revoked: boolean;
  newAccountsAvailable: boolean;
  needsTransactionsConsent: boolean;
}
