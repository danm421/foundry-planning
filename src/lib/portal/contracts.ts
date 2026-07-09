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

// ---- GET /api/portal/me (new in this plan) ----
export interface PortalMeDTO {
  client: { id: string; displayName: string; email: string };
  firm: { name: string; logoUrl: string | null };
  mode: PortalActorMode;
}
