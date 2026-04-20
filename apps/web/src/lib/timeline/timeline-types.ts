// src/lib/timeline/timeline-types.ts

export type TimelineCategory =
  | "life"
  | "income"
  | "transaction"
  | "portfolio"
  | "insurance"
  | "tax";

export type TimelineSubject = "primary" | "spouse" | "joint";

export interface TimelineEventDetail {
  label: string;
  value: string; // pre-formatted (currency/percent/text)
}

export interface TimelineEventLink {
  label: string;
  href: string;
}

export interface TimelineEvent {
  /** Stable id, e.g. `life:retire:primary` or `income:salary_start:primary:inc-salary-john`. Deterministic given the same input — year is only included when an event type can legitimately recur. */
  id: string;
  year: number;
  age?: number;
  category: TimelineCategory;
  subject: TimelineSubject;
  title: string;
  /** Collapsed-card one-liner. */
  supportingFigure?: string;
  /** Expanded-card key/value rows. */
  details: TimelineEventDetail[];
  links?: TimelineEventLink[];
}

export interface SeriesPoint {
  year: number;
  /** portfolioAssets.total − total liability balances at end of year. */
  netWorth: number;
  /** taxable + cash + retirement totals — investable assets only. */
  portfolio: number;
  /** ProjectionYear.netCashFlow. */
  netCashFlow: number;
}

/** Numeric priority used by build-timeline for dedupe + sort (lower = earlier/higher priority). */
export const CATEGORY_PRIORITY: Record<TimelineCategory, number> = {
  life: 0,
  income: 1,
  transaction: 2,
  portfolio: 3,
  insurance: 4,
  tax: 5,
};
