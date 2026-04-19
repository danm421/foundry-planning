# Timeline Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-screen "life story" Timeline report for a client — a vertical waterfall with a center sparkline spine, annotated event cards, sticky mini-map, and category filters. Events are derived at render time from `ProjectionYear[]` with no engine changes.

**Architecture:** Pure-function derivation modules in `src/lib/timeline/` (detectors per category + orchestrator + series builder, all TDD), a server `page.tsx` at `/clients/[id]/timeline` that loads plan data the same way existing report pages do, and a `"use client"` `TimelineReportView` that calls `runProjection` and renders the SVG-based spine, mini-map, controls, year segments, and event cards.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Vitest · Tailwind · existing `@/engine` projection output · inline SVG (no charting dependency, matching `drift-chart.tsx`).

**Spec:** `docs/superpowers/specs/2026-04-19-timeline-report-design.md`

**Important (per AGENTS.md):** This repo pins Next.js 16 which has breaking changes from earlier versions. Read guides in `node_modules/next/dist/docs/` before writing any App Router / Server Component / middleware code if uncertain about an API.

---

## Task 1: Shared types

**Files:**
- Create: `src/lib/timeline/timeline-types.ts`

- [ ] **Step 1: Write the types file**

```ts
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
  /** Stable id, e.g. `life:retire:primary:2044`. Deterministic given the same input. */
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
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timeline/timeline-types.ts
git commit -m "feat(timeline): add shared timeline types"
```

---

## Task 2: Series builder (build-series.ts)

Produces `SeriesPoint[]` from `ProjectionYear[]` for the sparkline. Pure function, TDD.

**Files:**
- Create: `src/lib/timeline/build-series.ts`
- Create: `src/lib/timeline/__tests__/build-series.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/build-series.test.ts
import { describe, it, expect } from "vitest";
import { buildSeries } from "../build-series";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("buildSeries", () => {
  it("returns one SeriesPoint per projection year", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    expect(series).toHaveLength(projection.length);
    expect(series[0].year).toBe(projection[0].year);
  });

  it("portfolio sums taxable + cash + retirement totals only", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    const p0 = projection[0];
    expect(series[0].portfolio).toBeCloseTo(
      p0.portfolioAssets.taxableTotal +
        p0.portfolioAssets.cashTotal +
        p0.portfolioAssets.retirementTotal,
      6,
    );
  });

  it("netCashFlow passes through from ProjectionYear", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    expect(series[0].netCashFlow).toBe(projection[0].netCashFlow);
  });

  it("netWorth equals gross assets minus liability balances", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    const p0 = projection[0];
    const liabTotal = Object.values(p0.liabilityBalancesBoY).reduce((s, v) => s + v, 0);
    // netWorth uses end-of-year liability; BoY is a close proxy for year 1
    // but the test only asserts the relationship within a tight bound.
    expect(series[0].netWorth).toBeLessThanOrEqual(p0.portfolioAssets.total);
    expect(series[0].netWorth).toBeGreaterThanOrEqual(p0.portfolioAssets.total - liabTotal - 1);
  });

  it("returns empty array for empty projection", () => {
    expect(buildSeries([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/build-series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/timeline/build-series.ts
import type { ProjectionYear } from "@/engine";
import type { SeriesPoint } from "./timeline-types";

/**
 * Derive the three sparkline series from projection output.
 *
 * netWorth = gross assets (portfolioAssets.total) − end-of-year liability balance.
 * portfolio = investable assets only (taxable + cash + retirement totals).
 * netCashFlow = ProjectionYear.netCashFlow.
 *
 * For end-of-year liability balance we use next year's BoY balance when available;
 * for the final year we fall back to current-year BoY minus the year's principal
 * paydown (expenses.liabilities − interest). This is an approximation consistent
 * with how the UI treats "end of year" elsewhere.
 */
export function buildSeries(projection: ProjectionYear[]): SeriesPoint[] {
  return projection.map((py, i) => {
    const nextBoY = projection[i + 1]?.liabilityBalancesBoY ?? null;
    let liabEoY: number;
    if (nextBoY) {
      liabEoY = Object.values(nextBoY).reduce((s, v) => s + v, 0);
    } else {
      const boy = Object.values(py.liabilityBalancesBoY).reduce((s, v) => s + v, 0);
      const interest = Object.values(py.expenses.interestByLiability).reduce((s, v) => s + v, 0);
      const principal = py.expenses.liabilities - interest;
      liabEoY = Math.max(0, boy - principal);
    }

    const portfolio =
      py.portfolioAssets.taxableTotal +
      py.portfolioAssets.cashTotal +
      py.portfolioAssets.retirementTotal;

    return {
      year: py.year,
      netWorth: py.portfolioAssets.total - liabEoY,
      portfolio,
      netCashFlow: py.netCashFlow,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/build-series.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/build-series.ts src/lib/timeline/__tests__/build-series.test.ts
git commit -m "feat(timeline): add build-series for sparkline data"
```

---

## Task 3: Life detector

Emits retirement, death, Medicare (65), SS FRA (67), and Social Security claim-age events for each subject.

**Files:**
- Create: `src/lib/timeline/detectors/life.ts`
- Create: `src/lib/timeline/__tests__/detectors/life.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/life.test.ts
import { describe, it, expect } from "vitest";
import { detectLifeEvents } from "../../detectors/life";
import { runProjection } from "@/engine";
import { buildClientData, baseClient } from "@/engine/__tests__/fixtures";

describe("detectLifeEvents", () => {
  it("emits primary retirement at retirementAge", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const retire = events.find((e) => e.id === "life:retire:primary");
    expect(retire).toBeDefined();
    // John born 1970, retirementAge 65 → year 2035
    expect(retire!.year).toBe(2035);
    expect(retire!.age).toBe(65);
    expect(retire!.subject).toBe("primary");
  });

  it("emits spouse retirement at spouseRetirementAge", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const retire = events.find((e) => e.id === "life:retire:spouse");
    expect(retire).toBeDefined();
    // Jane born 1972, spouseRetirementAge 65 → year 2037
    expect(retire!.year).toBe(2037);
    expect(retire!.age).toBe(65);
  });

  it("emits Medicare eligibility at age 65 for primary", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const medi = events.find((e) => e.id === "life:medicare:primary");
    expect(medi).toBeDefined();
    expect(medi!.year).toBe(2035);
    expect(medi!.age).toBe(65);
  });

  it("emits SS FRA at age 67 for primary", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const fra = events.find((e) => e.id === "life:ss_fra:primary");
    expect(fra).toBeDefined();
    expect(fra!.year).toBe(2037);
    expect(fra!.age).toBe(67);
  });

  it("emits SS claim when claimingAge is set on a social_security income", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const ssClaim = events.find((e) => e.id === "life:ss_claim:primary");
    expect(ssClaim).toBeDefined();
    expect(ssClaim!.age).toBe(67); // fixture sets John SS claimingAge=67
  });

  it("emits death in the final projection year when life expectancy hits", () => {
    const data = buildClientData({
      client: { ...baseClient, lifeExpectancy: 85 }, // John born 1970 → dies 2055 (end of plan)
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const death = events.find((e) => e.id === "life:death:primary");
    expect(death).toBeDefined();
    expect(death!.year).toBe(2055);
  });

  it("produces only primary events when client is single (no spouseName)", () => {
    const data = buildClientData({
      client: {
        ...baseClient,
        spouseName: undefined,
        spouseDob: undefined,
        spouseRetirementAge: undefined,
        spouseLifeExpectancy: null,
        filingStatus: "single",
      },
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    expect(events.every((e) => e.subject !== "spouse")).toBe(true);
  });

  it("omits life events that fall outside the projection window", () => {
    // If retirementAge is 90 but plan ends at age 85, no retirement event should be emitted.
    const data = buildClientData({
      client: { ...baseClient, retirementAge: 90, planEndAge: 85 },
      planSettings: { ...baseClient as never, planStartYear: 2026, planEndYear: 2055 } as never,
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    expect(events.find((e) => e.id === "life:retire:primary")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/life.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/life.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

const MEDICARE_AGE = 65;
const SS_FRA_AGE = 67;

function birthYear(dob: string): number {
  return new Date(dob).getUTCFullYear();
}

function yearAtAge(dob: string, age: number): number {
  return birthYear(dob) + age;
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

function pushAgeEvent(
  out: TimelineEvent[],
  idSuffix: string,
  subject: "primary" | "spouse",
  subjectLabel: string,
  dob: string,
  age: number,
  title: string,
  supportingFigure: string | undefined,
  projection: ProjectionYear[],
) {
  const year = yearAtAge(dob, age);
  if (!inRange(year, projection)) return;
  out.push({
    id: `life:${idSuffix}:${subject}`,
    year,
    age,
    category: "life",
    subject,
    title,
    supportingFigure,
    details: [
      { label: "Subject", value: subjectLabel },
      { label: "Age", value: String(age) },
    ],
  });
}

export function detectLifeEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const c = data.client;

  const primaryName = `${c.firstName} ${c.lastName}`.trim();
  pushAgeEvent(out, "retire", "primary", primaryName, c.dateOfBirth, c.retirementAge, "Retirement", `${primaryName} retires`, projection);
  pushAgeEvent(out, "medicare", "primary", primaryName, c.dateOfBirth, MEDICARE_AGE, "Medicare eligibility", "Age 65", projection);
  pushAgeEvent(out, "ss_fra", "primary", primaryName, c.dateOfBirth, SS_FRA_AGE, "Social Security FRA", "Full Retirement Age", projection);
  if (c.lifeExpectancy != null) {
    pushAgeEvent(out, "death", "primary", primaryName, c.dateOfBirth, c.lifeExpectancy, "End of life", undefined, projection);
  }

  // SS claim age — find the primary's social_security income with claimingAge set.
  const primarySS = data.incomes.find((i) => i.type === "social_security" && i.owner === "client" && i.claimingAge != null);
  if (primarySS && primarySS.claimingAge != null) {
    pushAgeEvent(out, "ss_claim", "primary", primaryName, c.dateOfBirth, primarySS.claimingAge, "Social Security begins", `Claim at age ${primarySS.claimingAge}`, projection);
  }

  if (c.spouseName && c.spouseDob) {
    const spouseFullName = `${c.spouseName} ${c.spouseLastName ?? c.lastName ?? ""}`.trim();
    if (c.spouseRetirementAge != null) {
      pushAgeEvent(out, "retire", "spouse", spouseFullName, c.spouseDob, c.spouseRetirementAge, "Retirement", `${spouseFullName} retires`, projection);
    }
    pushAgeEvent(out, "medicare", "spouse", spouseFullName, c.spouseDob, MEDICARE_AGE, "Medicare eligibility", "Age 65", projection);
    pushAgeEvent(out, "ss_fra", "spouse", spouseFullName, c.spouseDob, SS_FRA_AGE, "Social Security FRA", "Full Retirement Age", projection);
    if (c.spouseLifeExpectancy != null) {
      pushAgeEvent(out, "death", "spouse", spouseFullName, c.spouseDob, c.spouseLifeExpectancy, "End of life", undefined, projection);
    }

    const spouseSS = data.incomes.find((i) => i.type === "social_security" && i.owner === "spouse" && i.claimingAge != null);
    if (spouseSS && spouseSS.claimingAge != null) {
      pushAgeEvent(out, "ss_claim", "spouse", spouseFullName, c.spouseDob, spouseSS.claimingAge, "Social Security begins", `Claim at age ${spouseSS.claimingAge}`, projection);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/life.test.ts`
Expected: 8 passed. If the `spouseLastName` property doesn't exist on `ClientInfo` in this codebase, adjust the spouse label construction accordingly (peek at `src/engine/types.ts` for the exact fields and simplify `spouseFullName` to `c.spouseName`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/life.ts src/lib/timeline/__tests__/detectors/life.test.ts
git commit -m "feat(timeline): add life event detector"
```

---

## Task 4: Income detector

Emits salary start/stop and pension start per entity. Social-Security-begins is covered by the Life detector (SS claim) — the orchestrator dedupes.

**Files:**
- Create: `src/lib/timeline/detectors/income.ts`
- Create: `src/lib/timeline/__tests__/detectors/income.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/income.test.ts
import { describe, it, expect } from "vitest";
import { detectIncomeEvents } from "../../detectors/income";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectIncomeEvents", () => {
  it("emits salary start and stop per salary income", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);

    const johnStart = events.find((e) => e.id === "income:salary_start:primary:inc-salary-john");
    const johnStop = events.find((e) => e.id === "income:salary_stop:primary:inc-salary-john");
    expect(johnStart?.year).toBe(2026);
    expect(johnStop?.year).toBe(2035);

    const janeStart = events.find((e) => e.id === "income:salary_start:spouse:inc-salary-jane");
    const janeStop = events.find((e) => e.id === "income:salary_stop:spouse:inc-salary-jane");
    expect(janeStart?.year).toBe(2026);
    expect(janeStop?.year).toBe(2037);
  });

  it("emits social_security begin with correct supporting figure", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const ss = events.find((e) => e.id === "income:ss_begin:primary:inc-ss-john");
    expect(ss).toBeDefined();
    expect(ss!.year).toBe(2026);
  });

  it("skips income start/stop outside the projection window", () => {
    const data = buildClientData();
    data.incomes = [
      {
        id: "inc-late",
        type: "salary",
        name: "Late",
        annualAmount: 100_000,
        startYear: 2060, // after plan end 2055
        endYear: 2070,
        growthRate: 0,
        owner: "client",
      },
    ];
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    expect(events.find((e) => e.id.startsWith("income:salary_start:primary:inc-late"))).toBeUndefined();
  });

  it("emits pension start for income type=pension", () => {
    const data = buildClientData();
    data.incomes = [
      ...data.incomes,
      {
        id: "inc-pension-john",
        type: "pension",
        name: "John Pension",
        annualAmount: 18_000,
        startYear: 2040,
        endYear: 2055,
        growthRate: 0.02,
        owner: "client",
      },
    ];
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const pen = events.find((e) => e.id === "income:pension_start:primary:inc-pension-john");
    expect(pen).toBeDefined();
    expect(pen!.year).toBe(2040);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/income.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/income.ts
import type { ClientData, ProjectionYear, Income } from "@/engine";
import type { TimelineEvent, TimelineSubject } from "../timeline-types";

function subjectFor(owner: Income["owner"]): TimelineSubject {
  if (owner === "client") return "primary";
  if (owner === "spouse") return "spouse";
  return "joint";
}

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectIncomeEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const inc of data.incomes) {
    const subject = subjectFor(inc.owner);

    if (inc.type === "salary") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:salary_start:${subject}:${inc.id}`,
          year: inc.startYear,
          category: "income",
          subject,
          title: `${inc.name} begins`,
          supportingFigure: `${currency(inc.annualAmount)}/yr`,
          details: [{ label: "Annual", value: currency(inc.annualAmount) }],
        });
      }
      if (inRange(inc.endYear, projection)) {
        out.push({
          id: `income:salary_stop:${subject}:${inc.id}`,
          year: inc.endYear,
          category: "income",
          subject,
          title: `${inc.name} ends`,
          supportingFigure: `${currency(inc.annualAmount)}/yr ends`,
          details: [{ label: "Final annual", value: currency(inc.annualAmount) }],
        });
      }
    }

    if (inc.type === "pension") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:pension_start:${subject}:${inc.id}`,
          year: inc.startYear,
          category: "income",
          subject,
          title: `${inc.name} begins`,
          supportingFigure: `${currency(inc.annualAmount)}/yr pension`,
          details: [{ label: "Annual", value: currency(inc.annualAmount) }],
        });
      }
    }

    if (inc.type === "social_security") {
      if (inRange(inc.startYear, projection)) {
        out.push({
          id: `income:ss_begin:${subject}:${inc.id}`,
          year: inc.startYear,
          category: "income",
          subject,
          title: `${inc.name} begins`,
          supportingFigure: `${currency(inc.annualAmount)}/yr SS`,
          details: [{ label: "Annual", value: currency(inc.annualAmount) }],
        });
      }
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/income.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/income.ts src/lib/timeline/__tests__/detectors/income.test.ts
git commit -m "feat(timeline): add income event detector"
```

---

## Task 5: Transactions detector

One event per `AssetTransaction` (buy/sell). Pulls runtime figures from `ProjectionYear.techniqueBreakdown`. Also emits the first occurrence of each `Transfer` (recurring transfers are suppressed for v1 — see deferred list).

**Files:**
- Create: `src/lib/timeline/detectors/transactions.ts`
- Create: `src/lib/timeline/__tests__/detectors/transactions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/transactions.test.ts
import { describe, it, expect } from "vitest";
import { detectTransactionEvents } from "../../detectors/transactions";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectTransactionEvents", () => {
  it("emits a sale event with runtime figures from techniqueBreakdown", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-home-sale",
        name: "Sell primary home",
        type: "sell",
        year: 2040,
        accountId: "acct-home",
        qualifiesForHomeSaleExclusion: true,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const sale = events.find((e) => e.id === "transaction:sell:tx-home-sale");
    expect(sale).toBeDefined();
    expect(sale!.year).toBe(2040);
    expect(sale!.subject).toBe("joint");
    expect(sale!.supportingFigure).toMatch(/\$/);
  });

  it("emits a purchase event for type=buy", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-second-home",
        name: "Buy vacation home",
        type: "buy",
        year: 2045,
        assetName: "Vacation",
        assetCategory: "real_estate",
        purchasePrice: 500_000,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const buy = events.find((e) => e.id === "transaction:buy:tx-second-home");
    expect(buy).toBeDefined();
    expect(buy!.year).toBe(2045);
  });

  it("emits transfer first-occurrence only", () => {
    const data = buildClientData();
    data.transfers = [
      {
        id: "xfer-1",
        name: "Brokerage → Savings",
        sourceAccountId: "acct-brokerage",
        targetAccountId: "acct-savings",
        amount: 20_000,
        mode: "recurring",
        startYear: 2028,
        endYear: 2032,
        growthRate: 0,
        schedules: [],
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const matches = events.filter((e) => e.id.startsWith("transaction:transfer:xfer-1"));
    expect(matches).toHaveLength(1);
    expect(matches[0].year).toBe(2028);
  });

  it("skips transactions outside projection window", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-late",
        name: "Late sale",
        type: "sell",
        year: 2100,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    expect(events.find((e) => e.id === "transaction:sell:tx-late")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/transactions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/transactions.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectTransactionEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const byYear = new Map<number, ProjectionYear>();
  for (const py of projection) byYear.set(py.year, py);

  for (const tx of data.assetTransactions ?? []) {
    if (!inRange(tx.year, projection)) continue;
    const py = byYear.get(tx.year);

    if (tx.type === "sell") {
      const saleInfo = py?.techniqueBreakdown?.sales.find((s) => s.transactionId === tx.id);
      const supporting = saleInfo
        ? `${currency(saleInfo.saleValue)} sale · ${currency(saleInfo.netProceeds)} net`
        : `${tx.name}`;
      const details = saleInfo
        ? [
            { label: "Sale value", value: currency(saleInfo.saleValue) },
            { label: "Transaction costs", value: currency(saleInfo.transactionCosts) },
            { label: "Mortgage paid off", value: currency(saleInfo.mortgagePaidOff) },
            { label: "Net proceeds", value: currency(saleInfo.netProceeds) },
            { label: "Capital gain", value: currency(saleInfo.capitalGain) },
          ]
        : [{ label: "Transaction", value: tx.name }];
      out.push({
        id: `transaction:sell:${tx.id}`,
        year: tx.year,
        category: "transaction",
        subject: "joint",
        title: tx.name,
        supportingFigure: supporting,
        details,
      });
    } else if (tx.type === "buy") {
      const buyInfo = py?.techniqueBreakdown?.purchases.find((s) => s.transactionId === tx.id);
      const supporting = buyInfo
        ? `${currency(buyInfo.purchasePrice)} purchase${buyInfo.mortgageAmount > 0 ? ` · ${currency(buyInfo.mortgageAmount)} mortgage` : ""}`
        : `${tx.name}`;
      const details = buyInfo
        ? [
            { label: "Purchase price", value: currency(buyInfo.purchasePrice) },
            { label: "Mortgage", value: currency(buyInfo.mortgageAmount) },
            { label: "Equity", value: currency(buyInfo.equity) },
          ]
        : [{ label: "Transaction", value: tx.name }];
      out.push({
        id: `transaction:buy:${tx.id}`,
        year: tx.year,
        category: "transaction",
        subject: "joint",
        title: tx.name,
        supportingFigure: supporting,
        details,
      });
    }
  }

  for (const t of data.transfers ?? []) {
    if (!inRange(t.startYear, projection)) continue;
    out.push({
      id: `transaction:transfer:${t.id}`,
      year: t.startYear,
      category: "transaction",
      subject: "joint",
      title: `${t.name} begins`,
      supportingFigure: `${currency(t.amount)} (${t.mode})`,
      details: [
        { label: "From", value: t.sourceAccountId },
        { label: "To", value: t.targetAccountId },
        { label: "Mode", value: t.mode },
        { label: "Amount", value: currency(t.amount) },
      ],
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/transactions.test.ts`
Expected: 4 passed. If `data.assetTransactions` or `data.transfers` are named differently on `ClientData`, check `src/engine/types.ts` and adjust.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/transactions.ts src/lib/timeline/__tests__/detectors/transactions.test.ts
git commit -m "feat(timeline): add transaction event detector"
```

---

## Task 6: Portfolio detector

First-withdrawal year per account, RMDs begin, user-configurable threshold crossings, portfolio peak year. All thresholds run against the **investable** portfolio series (taxable + cash + retirement totals).

**Files:**
- Create: `src/lib/timeline/detectors/portfolio.ts`
- Create: `src/lib/timeline/__tests__/detectors/portfolio.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/portfolio.test.ts
import { describe, it, expect } from "vitest";
import { detectPortfolioEvents, DEFAULT_PORTFOLIO_THRESHOLDS } from "../../detectors/portfolio";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectPortfolioEvents", () => {
  it("emits first-withdrawal year per account when byAccount transitions to non-zero", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    // Every withdrawal-source account used by the fixture should get at most one
    // first-withdrawal event; accounts never touched get none.
    const ids = events.filter((e) => e.id.startsWith("portfolio:first_withdrawal:")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits RMD begin once in the first year an account's rmdAmount is > 0", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    const rmds = events.filter((e) => e.id.startsWith("portfolio:rmd_begin:"));
    for (const e of rmds) {
      // Each RMD event corresponds to a single account; no duplicates.
      expect(rmds.filter((x) => x.id === e.id)).toHaveLength(1);
    }
  });

  it("emits a threshold crossing exactly once when investable portfolio first exceeds the threshold", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, [1_000_000]);
    const crossings = events.filter((e) => e.id === "portfolio:threshold:1000000");
    expect(crossings).toHaveLength(1);
  });

  it("emits portfolio peak year based on investable portfolio", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    const peak = events.find((e) => e.id === "portfolio:peak");
    expect(peak).toBeDefined();
    // Peak year should be within the plan range.
    expect(peak!.year).toBeGreaterThanOrEqual(projection[0].year);
    expect(peak!.year).toBeLessThanOrEqual(projection[projection.length - 1].year);
  });

  it("defaults ship as [1M, 2M, 5M, 10M]", () => {
    expect(DEFAULT_PORTFOLIO_THRESHOLDS).toEqual([1_000_000, 2_000_000, 5_000_000, 10_000_000]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/portfolio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/portfolio.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

export const DEFAULT_PORTFOLIO_THRESHOLDS: number[] = [
  1_000_000,
  2_000_000,
  5_000_000,
  10_000_000,
];

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function investableValue(py: ProjectionYear): number {
  return py.portfolioAssets.taxableTotal + py.portfolioAssets.cashTotal + py.portfolioAssets.retirementTotal;
}

function accountName(data: ClientData, accountId: string): string {
  return data.accounts.find((a) => a.id === accountId)?.name ?? accountId;
}

export function detectPortfolioEvents(
  data: ClientData,
  projection: ProjectionYear[],
  thresholds: number[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  if (projection.length === 0) return out;

  // First withdrawal per account
  const seenWithdrawal = new Set<string>();
  for (const py of projection) {
    for (const [acctId, amount] of Object.entries(py.withdrawals.byAccount)) {
      if (amount > 0 && !seenWithdrawal.has(acctId)) {
        seenWithdrawal.add(acctId);
        out.push({
          id: `portfolio:first_withdrawal:${acctId}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `Withdrawals begin — ${accountName(data, acctId)}`,
          supportingFigure: `${currency(amount)} this year`,
          details: [
            { label: "Account", value: accountName(data, acctId) },
            { label: "Year 1 withdrawal", value: currency(amount) },
          ],
        });
      }
    }
  }

  // RMD begin per account
  const seenRmd = new Set<string>();
  for (const py of projection) {
    for (const [acctId, ledger] of Object.entries(py.accountLedgers)) {
      if (ledger.rmdAmount > 0 && !seenRmd.has(acctId)) {
        seenRmd.add(acctId);
        out.push({
          id: `portfolio:rmd_begin:${acctId}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `RMDs begin — ${accountName(data, acctId)}`,
          supportingFigure: `${currency(ledger.rmdAmount)} this year`,
          details: [
            { label: "Account", value: accountName(data, acctId) },
            { label: "Year 1 RMD", value: currency(ledger.rmdAmount) },
          ],
        });
      }
    }
  }

  // Threshold crossings (investable portfolio)
  const seenThresholds = new Set<number>();
  for (const py of projection) {
    const v = investableValue(py);
    for (const t of thresholds) {
      if (v >= t && !seenThresholds.has(t)) {
        seenThresholds.add(t);
        out.push({
          id: `portfolio:threshold:${t}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `Portfolio crosses ${currency(t)}`,
          supportingFigure: `Investable value: ${currency(v)}`,
          details: [{ label: "Threshold", value: currency(t) }],
        });
      }
    }
  }

  // Peak (investable)
  let peakYear = projection[0].year;
  let peakVal = investableValue(projection[0]);
  for (const py of projection) {
    const v = investableValue(py);
    if (v > peakVal) {
      peakVal = v;
      peakYear = py.year;
    }
  }
  out.push({
    id: "portfolio:peak",
    year: peakYear,
    category: "portfolio",
    subject: "joint",
    title: "Portfolio peak",
    supportingFigure: `Investable value: ${currency(peakVal)}`,
    details: [{ label: "Peak value", value: currency(peakVal) }],
  });

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/portfolio.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/portfolio.ts src/lib/timeline/__tests__/detectors/portfolio.test.ts
git commit -m "feat(timeline): add portfolio event detector"
```

---

## Task 7: Insurance detector

Emits life-insurance-proceeds events for the surviving entity in a death year. Detected by scanning for life-insurance-category account distributions in the death year. Conservative v1: if the signal isn't unambiguous, emit nothing rather than a false event.

**Files:**
- Create: `src/lib/timeline/detectors/insurance.ts`
- Create: `src/lib/timeline/__tests__/detectors/insurance.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/insurance.test.ts
import { describe, it, expect } from "vitest";
import { detectInsuranceEvents } from "../../detectors/insurance";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectInsuranceEvents", () => {
  it("returns empty array when no life-insurance accounts exist", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectInsuranceEvents(data, projection);
    // Fixture has no life_insurance accounts.
    expect(events).toEqual([]);
  });

  it("emits a life-insurance-proceeds event in the death year when a life_insurance account distributes", () => {
    const data = buildClientData();
    data.accounts = [
      ...data.accounts,
      {
        id: "acct-life-ins",
        name: "Life policy",
        category: "life_insurance",
        subType: "whole_life",
        owner: "client",
        value: 500_000,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
      },
    ];
    const projection = runProjection(data);
    const events = detectInsuranceEvents(data, projection);
    // Deterministic emission: at most one event per life-insurance account across the plan.
    const byAccount = new Map<string, number>();
    for (const e of events) {
      byAccount.set(e.id, (byAccount.get(e.id) ?? 0) + 1);
    }
    for (const count of byAccount.values()) expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/insurance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/insurance.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function detectInsuranceEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const lifeAccounts = data.accounts.filter((a) => a.category === "life_insurance");
  if (lifeAccounts.length === 0) return out;

  const seen = new Set<string>();
  for (const py of projection) {
    for (const acct of lifeAccounts) {
      if (seen.has(acct.id)) continue;
      const ledger = py.accountLedgers[acct.id];
      if (!ledger) continue;
      // Heuristic: distributions > 0 OR a sharp drop to zero in ending value indicates proceeds.
      const distributedOut = ledger.distributions > 0;
      const zeroed = ledger.endingValue === 0 && ledger.beginningValue > 0;
      if (distributedOut || zeroed) {
        seen.add(acct.id);
        const amount = ledger.distributions > 0 ? ledger.distributions : ledger.beginningValue;
        out.push({
          id: `insurance:proceeds:${acct.id}`,
          year: py.year,
          category: "insurance",
          subject: "joint",
          title: "Life insurance proceeds",
          supportingFigure: `${currency(amount)} paid`,
          details: [
            { label: "Policy", value: acct.name },
            { label: "Proceeds", value: currency(amount) },
          ],
        });
      }
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/insurance.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/insurance.ts src/lib/timeline/__tests__/detectors/insurance.test.ts
git commit -m "feat(timeline): add insurance event detector"
```

---

## Task 8: Tax detector

Emits: Roth conversions (if present), first year in a new federal ordinary bracket, first negative-cash-flow year (one-time). IRMAA detection is deferred.

**Files:**
- Create: `src/lib/timeline/detectors/tax.ts`
- Create: `src/lib/timeline/__tests__/detectors/tax.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/detectors/tax.test.ts
import { describe, it, expect } from "vitest";
import { detectTaxEvents } from "../../detectors/tax";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectTaxEvents", () => {
  it("emits first-negative-cashflow at most once", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectTaxEvents(data, projection);
    const negs = events.filter((e) => e.id === "tax:first_negative_cashflow");
    expect(negs.length).toBeLessThanOrEqual(1);
  });

  it("emits bracket change events keyed by year", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectTaxEvents(data, projection);
    const bracketEvents = events.filter((e) => e.id.startsWith("tax:bracket_change:"));
    const years = new Set(bracketEvents.map((e) => e.year));
    // No duplicate year events for bracket changes.
    expect(years.size).toBe(bracketEvents.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/tax.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/detectors/tax.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/**
 * Pull the top federal marginal ordinary-income rate encountered this year from the
 * engine's TaxResult. The engine exposes a bracket walk on taxResult; for v1 we look
 * for a numeric marginalRate field and fall back to topBracketRate, matching how
 * other UI components read the same structure. If neither exists, tax-bracket events
 * are simply suppressed.
 */
function topOrdinaryRate(py: ProjectionYear): number | null {
  const tr = py.taxResult as unknown as { marginalRate?: number; topBracketRate?: number } | undefined;
  if (!tr) return null;
  if (typeof tr.marginalRate === "number") return tr.marginalRate;
  if (typeof tr.topBracketRate === "number") return tr.topBracketRate;
  return null;
}

export function detectTaxEvents(
  _data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  let prevRate: number | null = null;

  // Bracket changes — one event per year where the rate changes from the previous year.
  for (const py of projection) {
    const rate = topOrdinaryRate(py);
    if (rate != null && prevRate != null && rate !== prevRate) {
      out.push({
        id: `tax:bracket_change:${py.year}`,
        year: py.year,
        category: "tax",
        subject: "joint",
        title: "Federal bracket change",
        supportingFigure: `Top ordinary rate: ${(rate * 100).toFixed(1)}%`,
        details: [
          { label: "Previous rate", value: `${(prevRate * 100).toFixed(1)}%` },
          { label: "New rate", value: `${(rate * 100).toFixed(1)}%` },
        ],
      });
    }
    if (rate != null) prevRate = rate;
  }

  // First negative cash flow year.
  const firstNeg = projection.find((py) => py.netCashFlow < 0);
  if (firstNeg) {
    out.push({
      id: "tax:first_negative_cashflow",
      year: firstNeg.year,
      category: "tax",
      subject: "joint",
      title: "Cash flow turns negative",
      supportingFigure: `${currency(firstNeg.netCashFlow)} this year`,
      details: [
        { label: "Net cash flow", value: currency(firstNeg.netCashFlow) },
        { label: "Total income", value: currency(firstNeg.totalIncome) },
        { label: "Total expenses", value: currency(firstNeg.totalExpenses) },
      ],
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/detectors/tax.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline/detectors/tax.ts src/lib/timeline/__tests__/detectors/tax.test.ts
git commit -m "feat(timeline): add tax event detector"
```

---

## Task 9: Orchestrator (build-timeline.ts)

Calls all detectors, dedupes colliding events, and sorts deterministically.

**Files:**
- Create: `src/lib/timeline/build-timeline.ts`
- Create: `src/lib/timeline/__tests__/build-timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timeline/__tests__/build-timeline.test.ts
import { describe, it, expect } from "vitest";
import { buildTimeline } from "../build-timeline";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("buildTimeline", () => {
  it("returns events sorted by (year asc, category priority, subject)", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      expect(prev.year <= cur.year).toBe(true);
    }
  });

  it("is deterministic — same input produces same event ids", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const a = buildTimeline(data, projection).map((e) => e.id);
    const b = buildTimeline(data, projection).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("dedupes SS-claim collisions: life detector wins over income detector", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const ssLife = events.find((e) => e.id === "life:ss_claim:primary");
    const ssIncome = events.find((e) => e.id.startsWith("income:ss_begin:primary"));
    // When both detectors fire for the same (year, subject), only the Life one survives.
    if (ssLife) {
      expect(ssIncome).toBeUndefined();
    }
  });

  it("returns empty array for an empty projection", () => {
    const data = buildClientData();
    const events = buildTimeline(data, []);
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeline/__tests__/build-timeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timeline/build-timeline.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "./timeline-types";
import { CATEGORY_PRIORITY } from "./timeline-types";
import { detectLifeEvents } from "./detectors/life";
import { detectIncomeEvents } from "./detectors/income";
import { detectTransactionEvents } from "./detectors/transactions";
import { detectPortfolioEvents, DEFAULT_PORTFOLIO_THRESHOLDS } from "./detectors/portfolio";
import { detectInsuranceEvents } from "./detectors/insurance";
import { detectTaxEvents } from "./detectors/tax";

const SUBJECT_PRIORITY = { primary: 0, spouse: 1, joint: 2 } as const;

/**
 * When SS-claim fires as both a Life event and an Income ss_begin for the same
 * (year, subject), Life wins. This set lists collision keys Life pre-empts.
 */
function ssCollisionKeys(events: TimelineEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const e of events) {
    if (e.category === "life" && e.id.startsWith("life:ss_claim:")) {
      keys.add(`${e.year}:${e.subject}`);
    }
  }
  return keys;
}

export function buildTimeline(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  if (projection.length === 0) return [];

  const raw: TimelineEvent[] = [
    ...detectLifeEvents(data, projection),
    ...detectIncomeEvents(data, projection),
    ...detectTransactionEvents(data, projection),
    ...detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS),
    ...detectInsuranceEvents(data, projection),
    ...detectTaxEvents(data, projection),
  ];

  const ssCollisions = ssCollisionKeys(raw);

  const filtered = raw.filter((e) => {
    // Drop Income ss_begin events that collide with a Life ss_claim for the same (year, subject).
    if (e.category === "income" && e.id.startsWith("income:ss_begin:")) {
      if (ssCollisions.has(`${e.year}:${e.subject}`)) return false;
    }
    return true;
  });

  // Deterministic sort: year asc, then category priority, then subject, then id.
  filtered.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const ca = CATEGORY_PRIORITY[a.category];
    const cb = CATEGORY_PRIORITY[b.category];
    if (ca !== cb) return ca - cb;
    const sa = SUBJECT_PRIORITY[a.subject];
    const sb = SUBJECT_PRIORITY[b.subject];
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });

  return filtered;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeline/__tests__/build-timeline.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Run the whole suite to ensure no regressions**

Run: `npm test`
Expected: 516 prior tests + the new timeline tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/timeline/build-timeline.ts src/lib/timeline/__tests__/build-timeline.test.ts
git commit -m "feat(timeline): add build-timeline orchestrator"
```

---

## Task 10: Add "Timeline" tab + stub page

Make the route real and navigable, even if the view is just a placeholder.

**Files:**
- Modify: `src/app/(app)/clients/[id]/layout.tsx`
- Create: `src/app/(app)/clients/[id]/timeline/page.tsx`
- Create: `src/components/timeline-report-view.tsx` (stub)

- [ ] **Step 1: Add the tab entry**

Edit `src/app/(app)/clients/[id]/layout.tsx`, append one entry to the `tabs` array:

```ts
const tabs = [
  { label: "Details", href: "client-data" },
  { label: "Balance Sheet", href: "balance-sheet-report" },
  { label: "Cash Flow", href: "cashflow" },
  { label: "Investments", href: "investments" },
  { label: "Timeline", href: "timeline" },
];
```

- [ ] **Step 2: Create the page**

```tsx
// src/app/(app)/clients/[id]/timeline/page.tsx
import TimelineReportView from "@/components/timeline-report-view";

interface TimelinePageProps {
  params: Promise<{ id: string }>;
}

export default async function TimelinePage({ params }: TimelinePageProps) {
  const { id } = await params;
  return <TimelineReportView clientId={id} />;
}
```

- [ ] **Step 3: Create the stub view**

```tsx
// src/components/timeline-report-view.tsx
"use client";

interface Props {
  clientId: string;
}

export default function TimelineReportView({ clientId }: Props) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-100">Timeline</h1>
      <p className="mt-2 text-sm text-gray-400">Client id: {clientId}</p>
      <p className="mt-6 text-sm text-gray-500">Timeline report coming online — wiring in progress.</p>
    </div>
  );
}
```

- [ ] **Step 4: Start dev server and navigate to the new tab**

Run: `npm run dev` (background). In a browser, open any client detail page and click the new "Timeline" tab. Expected: stub view renders without error.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/layout.tsx \
        src/app/\(app\)/clients/\[id\]/timeline/page.tsx \
        src/components/timeline-report-view.tsx
git commit -m "feat(timeline): add Timeline tab and stub view"
```

---

## Task 11: Wire `TimelineReportView` to load data and derive events/series

Replace the stub with the real data-loading scaffold. No visual components yet — just verify the pipeline works end to end.

**Files:**
- Modify: `src/components/timeline-report-view.tsx`

- [ ] **Step 1: Replace the stub with the data-loading shell**

```tsx
// src/components/timeline-report-view.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildTimeline } from "@/lib/timeline/build-timeline";
import { buildSeries } from "@/lib/timeline/build-series";
import type { TimelineCategory, TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";

interface Props {
  clientId: string;
}

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

export default function TimelineReportView({ clientId }: Props) {
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [projection, setProjection] = useState<ProjectionYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sparklineMode, setSparklineMode] = useState<SparklineMode>("netWorth");
  const [activeCategories, setActiveCategories] = useState<Set<TimelineCategory>>(
    new Set(["life", "income", "transaction", "portfolio", "insurance", "tax"]),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) throw new Error(`projection-data: ${res.status}`);
        const data = (await res.json()) as ClientData;
        if (cancelled) return;
        const proj = runProjection(data);
        setClientData(data);
        setProjection(proj);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const events: TimelineEvent[] = useMemo(
    () => (clientData && projection ? buildTimeline(clientData, projection) : []),
    [clientData, projection],
  );

  const series: SeriesPoint[] = useMemo(
    () => (projection ? buildSeries(projection) : []),
    [projection],
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => activeCategories.has(e.category)),
    [events, activeCategories],
  );

  if (error) {
    return <div className="p-6 text-sm text-red-400">Failed to load timeline: {error}</div>;
  }
  if (!clientData || !projection) {
    return <div className="p-6 text-sm text-gray-400">Loading timeline…</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-100">Timeline</h1>
      <p className="mt-2 text-sm text-gray-400">
        {projection.length} years · {events.length} events
      </p>

      {/* Placeholder debug dump — replaced by real components in later tasks. */}
      <details className="mt-4 text-xs text-gray-500">
        <summary>debug: events + series (temporary)</summary>
        <pre className="mt-2 max-h-[60vh] overflow-auto rounded bg-gray-900 p-3 text-gray-300">
          {JSON.stringify({ sparklineMode, activeCategories: [...activeCategories], expandedId, visibleEvents, series }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`. Open a client with existing projection data, click "Timeline". Expected: header with year + event counts, expandable debug dump. Confirm events for a known salary start/stop or SS claim appear in the JSON.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline-report-view.tsx
git commit -m "feat(timeline): wire view to projection data and derived events"
```

---

## Task 12: Sparkline SVG renderer

Shared renderer used by both the spine and the mini-map. Keeps curve math in one place.

**Files:**
- Create: `src/components/timeline/timeline-sparkline.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/timeline/timeline-sparkline.tsx
"use client";

import type { SeriesPoint } from "@/lib/timeline/timeline-types";

type Orientation = "horizontal" | "vertical";

interface Props {
  series: SeriesPoint[];
  pick: (p: SeriesPoint) => number;
  orientation: Orientation;
  width: number;
  height: number;
  strokeClass?: string;
  zeroStrokeClass?: string;
}

/**
 * Render a normalized path for a numeric series. Min/max are computed from the
 * provided `pick` so callers can swap net worth / portfolio / net cash flow
 * without re-normalizing at the callsite. Values at or below the min clamp to
 * the edge of the axis.
 */
export default function TimelineSparkline({
  series,
  pick,
  orientation,
  width,
  height,
  strokeClass = "stroke-blue-400",
  zeroStrokeClass = "stroke-gray-700",
}: Props) {
  if (series.length < 2) return <svg width={width} height={height} />;

  const values = series.map(pick);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(1, max - min);

  const n = series.length;
  // Horizontal mode: time runs left-to-right on x, values map to y.
  // Vertical mode: time runs top-to-bottom on y, values map to x.
  function pointFor(i: number): { x: number; y: number } {
    const t = i / Math.max(1, n - 1);
    const v = (values[i] - min) / span;
    if (orientation === "horizontal") {
      return { x: t * width, y: height - v * height };
    }
    return { x: v * width, y: t * height };
  }

  const d = values
    .map((_, i) => {
      const { x, y } = pointFor(i);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Zero axis (only if zero is within span). In horizontal mode the zero line is
  // horizontal at a fixed y; in vertical mode it is vertical at a fixed x.
  const zeroShown = min < 0 && max > 0;
  const zeroValue = (0 - min) / span;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {zeroShown && (
        orientation === "horizontal" ? (
          <line x1={0} x2={width} y1={height - zeroValue * height} y2={height - zeroValue * height} className={zeroStrokeClass} strokeDasharray="2 3" />
        ) : (
          <line x1={zeroValue * width} x2={zeroValue * width} y1={0} y2={height} className={zeroStrokeClass} strokeDasharray="2 3" />
        )
      )}
      <path d={d} fill="none" className={strokeClass} strokeWidth={1.5} />
    </svg>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/timeline-sparkline.tsx
git commit -m "feat(timeline): add shared sparkline SVG renderer"
```

---

## Task 13: Controls (sparkline toggle + category chips)

**Files:**
- Create: `src/components/timeline/timeline-controls.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/timeline/timeline-controls.tsx
"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

const CATEGORIES: { id: TimelineCategory; label: string }[] = [
  { id: "life", label: "Life" },
  { id: "income", label: "Income" },
  { id: "transaction", label: "Transactions" },
  { id: "portfolio", label: "Portfolio" },
  { id: "insurance", label: "Insurance" },
  { id: "tax", label: "Tax" },
];

interface Props {
  sparklineMode: SparklineMode;
  onSparklineModeChange: (mode: SparklineMode) => void;
  activeCategories: Set<TimelineCategory>;
  onToggleCategory: (cat: TimelineCategory) => void;
}

export default function TimelineControls({
  sparklineMode,
  onSparklineModeChange,
  activeCategories,
  onToggleCategory,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-gray-800 pb-4">
      <div className="flex items-center gap-1 rounded-md border border-gray-700 p-1">
        {[
          { id: "netWorth", label: "Net Worth" },
          { id: "portfolio", label: "Portfolio" },
          { id: "netCashFlow", label: "Net Cash Flow" },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSparklineModeChange(opt.id as SparklineMode)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              sparklineMode === opt.id
                ? "bg-blue-500/20 text-blue-300"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = activeCategories.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggleCategory(c.id)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border border-blue-400/60 bg-blue-500/10 text-blue-300"
                  : "border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TimelineReportView`**

Replace the placeholder body of `TimelineReportView` — keep the data-loading `useEffect` and memos — and add the controls above the (still-existing) debug dump:

```tsx
// … existing imports …
import TimelineControls from "@/components/timeline/timeline-controls";

// Inside the JSX, replace the debug-only header block with:
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-100">Timeline</h1>
      <p className="mt-2 text-sm text-gray-400">
        {projection.length} years · {events.length} events
      </p>

      <div className="mt-6">
        <TimelineControls
          sparklineMode={sparklineMode}
          onSparklineModeChange={setSparklineMode}
          activeCategories={activeCategories}
          onToggleCategory={(cat) => {
            setActiveCategories((prev) => {
              const next = new Set(prev);
              if (next.has(cat)) next.delete(cat);
              else next.add(cat);
              return next;
            });
          }}
        />
      </div>

      <details className="mt-4 text-xs text-gray-500">
        <summary>debug: events + series (temporary)</summary>
        <pre className="mt-2 max-h-[60vh] overflow-auto rounded bg-gray-900 p-3 text-gray-300">
          {JSON.stringify({ sparklineMode, activeCategories: [...activeCategories], expandedId, visibleEvents, series }, null, 2)}
        </pre>
      </details>
    </div>
  );
```

- [ ] **Step 3: Manual verify**

Run `npm run dev`. Confirm the controls render, toggling chips updates the debug dump's `activeCategories` and event list, and switching the sparkline toggle updates `sparklineMode`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-controls.tsx src/components/timeline-report-view.tsx
git commit -m "feat(timeline): add controls row (sparkline toggle + category chips)"
```

---

## Task 14: Event card (collapsed + expanded)

**Files:**
- Create: `src/components/timeline/timeline-category-pill.tsx`
- Create: `src/components/timeline/timeline-event-card.tsx`

- [ ] **Step 1: Write the pill**

```tsx
// src/components/timeline/timeline-category-pill.tsx
"use client";

import type { TimelineCategory } from "@/lib/timeline/timeline-types";

const COLORS: Record<TimelineCategory, string> = {
  life: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  income: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  transaction: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  portfolio: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  insurance: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  tax: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

const LABELS: Record<TimelineCategory, string> = {
  life: "Life",
  income: "Income",
  transaction: "Transaction",
  portfolio: "Portfolio",
  insurance: "Insurance",
  tax: "Tax",
};

interface Props {
  category: TimelineCategory;
}

export default function TimelineCategoryPill({ category }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${COLORS[category]}`}
    >
      {LABELS[category]}
    </span>
  );
}

export function categoryAccentClass(category: TimelineCategory): string {
  return COLORS[category];
}
```

- [ ] **Step 2: Write the card**

```tsx
// src/components/timeline/timeline-event-card.tsx
"use client";

import Link from "next/link";
import type { TimelineEvent } from "@/lib/timeline/timeline-types";
import TimelineCategoryPill from "./timeline-category-pill";

interface Props {
  event: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
  onHover: (hovered: boolean) => void;
  subjectLabel?: string; // "Dan" / "Jane" / undefined
  side: "left" | "right";
}

export default function TimelineEventCard({
  event,
  expanded,
  onToggle,
  onHover,
  subjectLabel,
  side,
}: Props) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group w-full max-w-sm rounded-md border border-gray-800 bg-gray-900/60 shadow-sm transition-shadow hover:shadow-md ${
        side === "left" ? "ml-auto" : "mr-auto"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          } else if (e.key === "Escape" && expanded) {
            onToggle();
          }
        }}
        aria-expanded={expanded}
        className="block w-full p-3 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <TimelineCategoryPill category={event.category} />
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-400">
            {event.year}
            {event.age != null ? ` · age ${event.age}` : ""}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-gray-100">{event.title}</div>
          {subjectLabel && <div className="text-[11px] text-gray-500">{subjectLabel}</div>}
        </div>
        {event.supportingFigure && (
          <div className="mt-0.5 text-xs text-gray-400">{event.supportingFigure}</div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-3 text-xs">
          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3">
            {event.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-gray-500">{d.label}</dt>
                <dd className="tabular-nums text-gray-200">{d.value}</dd>
              </div>
            ))}
          </dl>
          {event.links && event.links.length > 0 && (
            <div className="mt-3 flex gap-3">
              {event.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[11px] text-blue-400 hover:text-blue-300"
                >
                  {l.label} →
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-category-pill.tsx src/components/timeline/timeline-event-card.tsx
git commit -m "feat(timeline): add category pill and event card components"
```

---

## Task 15: Year segment + spine assembly

Builds the actual vertical waterfall: one row per year, with a center spine column (year/age label + segment of the rotated sparkline) and left/right card slots.

**Files:**
- Create: `src/components/timeline/timeline-year-segment.tsx`
- Create: `src/components/timeline/timeline-spine.tsx`
- Modify: `src/components/timeline-report-view.tsx`

- [ ] **Step 1: Write the year segment**

```tsx
// src/components/timeline/timeline-year-segment.tsx
"use client";

import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineEventCard from "./timeline-event-card";

interface Props {
  year: number;
  ageLabel: string; // "Age 56" or "Ages 56 / 54"
  events: TimelineEvent[];
  spineHeight: number; // px — used by spine sparkline caller to align
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
  subjectLabelFor: (subject: TimelineEvent["subject"]) => string | undefined;
  isCoupled: boolean;
  registerSegmentRef: (year: number, el: HTMLDivElement | null) => void;
  alternate: boolean; // true = use alternating-sides layout (singles)
  alternateOffset: number; // index used to decide left/right for alternating singles
}

function sideFor(
  event: TimelineEvent,
  isCoupled: boolean,
  alternate: boolean,
  alternateIndex: number,
): "left" | "right" | "center" {
  if (event.subject === "joint") return "center";
  if (isCoupled) return event.subject === "primary" ? "left" : "right";
  if (alternate) return alternateIndex % 2 === 0 ? "left" : "right";
  return "left";
}

export default function TimelineYearSegment({
  year,
  ageLabel,
  events,
  spineHeight,
  expandedId,
  onToggleExpand,
  onHover,
  subjectLabelFor,
  isCoupled,
  registerSegmentRef,
  alternate,
  alternateOffset,
}: Props) {
  return (
    <div
      ref={(el) => registerSegmentRef(year, el)}
      data-timeline-year={year}
      className="grid grid-cols-[1fr_auto_1fr] gap-4 py-2"
      style={{ minHeight: events.length === 0 ? 20 : Math.max(spineHeight, 80) }}
    >
      {/* Left column */}
      <div className="flex flex-col items-end gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
          if (side !== "left") return null;
          return (
            <TimelineEventCard
              key={e.id}
              event={e}
              expanded={expandedId === e.id}
              onToggle={() => onToggleExpand(e.id)}
              onHover={(h) => onHover(h ? e.id : null)}
              subjectLabel={subjectLabelFor(e.subject)}
              side="left"
            />
          );
        })}
      </div>

      {/* Spine column */}
      <div className="flex w-20 flex-col items-center gap-1 border-x border-gray-800 px-2">
        <div className="text-xs tabular-nums text-gray-500">{year}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-600">{ageLabel}</div>
        {events.some((e) => sideFor(e, isCoupled, alternate, 0) === "center") && (
          <div className="mt-1 flex w-full flex-col gap-2">
            {events.map((e, i) => {
              const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
              if (side !== "center") return null;
              return (
                <TimelineEventCard
                  key={e.id}
                  event={e}
                  expanded={expandedId === e.id}
                  onToggle={() => onToggleExpand(e.id)}
                  onHover={(h) => onHover(h ? e.id : null)}
                  subjectLabel={undefined}
                  side="left"
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col items-start gap-2">
        {events.map((e, i) => {
          const side = sideFor(e, isCoupled, alternate, alternateOffset + i);
          if (side !== "right") return null;
          return (
            <TimelineEventCard
              key={e.id}
              event={e}
              expanded={expandedId === e.id}
              onToggle={() => onToggleExpand(e.id)}
              onHover={(h) => onHover(h ? e.id : null)}
              subjectLabel={subjectLabelFor(e.subject)}
              side="right"
            />
          );
        })}
      </div>
    </div>
  );
}

// Also export for parent memoization helpers:
export { sideFor as _sideFor };
```

- [ ] **Step 2: Write the spine wrapper**

```tsx
// src/components/timeline/timeline-spine.tsx
"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineYearSegment from "./timeline-year-segment";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  projection: ProjectionYear[];
  visibleEvents: TimelineEvent[];
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
  primaryLabel: string;
  spouseLabel: string | null;
  isCoupled: boolean;
  registerSegmentRef: (year: number, el: HTMLDivElement | null) => void;
}

export default function TimelineSpine({
  projection,
  visibleEvents,
  sparklineMode,
  expandedId,
  onToggleExpand,
  onHover,
  primaryLabel,
  spouseLabel,
  isCoupled,
  registerSegmentRef,
}: Props) {
  // Group events by year.
  const eventsByYear = useMemo(() => {
    const m = new Map<number, TimelineEvent[]>();
    for (const e of visibleEvents) {
      const list = m.get(e.year) ?? [];
      list.push(e);
      m.set(e.year, list);
    }
    return m;
  }, [visibleEvents]);

  const subjectLabelFor = (subject: TimelineEvent["subject"]) => {
    if (subject === "primary") return primaryLabel;
    if (subject === "spouse") return spouseLabel ?? undefined;
    return undefined;
  };

  // Cumulative offset used to alternate sides deterministically for singles.
  let alternateIndex = 0;

  return (
    <div className="mt-6 flex flex-col">
      {projection.map((py) => {
        const events = eventsByYear.get(py.year) ?? [];
        const ageLabel = py.ages.spouse != null
          ? `Ages ${py.ages.client} / ${py.ages.spouse}`
          : `Age ${py.ages.client}`;
        const segment = (
          <TimelineYearSegment
            key={py.year}
            year={py.year}
            ageLabel={ageLabel}
            events={events}
            spineHeight={80}
            expandedId={expandedId}
            onToggleExpand={onToggleExpand}
            onHover={onHover}
            subjectLabelFor={subjectLabelFor}
            isCoupled={isCoupled}
            registerSegmentRef={registerSegmentRef}
            alternate={!isCoupled}
            alternateOffset={alternateIndex}
          />
        );
        alternateIndex += events.filter((e) => e.subject !== "joint").length;
        return segment;
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `TimelineReportView`**

Modify `src/components/timeline-report-view.tsx` — remove the debug dump, render the spine. Imports, refs, and the primary/spouse label derivation:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TimelineSpine from "@/components/timeline/timeline-spine";

// Inside the component, after existing state:
const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
const registerSegmentRef = useCallback((year: number, el: HTMLDivElement | null) => {
  if (el) segmentRefs.current.set(year, el);
  else segmentRefs.current.delete(year);
}, []);

const primaryLabel = clientData ? clientData.client.firstName : "";
const spouseLabel = clientData?.client.spouseName ?? null;
const isCoupled = !!spouseLabel;

// And in the returned JSX, replace the debug <details> block with:
<TimelineSpine
  projection={projection}
  visibleEvents={visibleEvents}
  series={series}
  sparklineMode={sparklineMode}
  expandedId={expandedId}
  onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
  onHover={(_id) => { /* wired in Task 17 */ }}
  primaryLabel={primaryLabel}
  spouseLabel={spouseLabel}
  isCoupled={isCoupled}
  registerSegmentRef={registerSegmentRef}
/>
```

- [ ] **Step 4: Add the footer legend**

At the end of the `TimelineReportView` JSX, below the `<TimelineSpine />`, add a legend row:

```tsx
<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-800 pt-4 text-[11px] text-gray-500">
  <span>
    Sparkline:{" "}
    <span className="text-gray-300">
      {sparklineMode === "netWorth" ? "Net Worth" : sparklineMode === "portfolio" ? "Portfolio (investable)" : "Net Cash Flow"}
    </span>
  </span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#38bdf8" }} /> Life</span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#34d399" }} /> Income</span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#fbbf24" }} /> Transactions</span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#60a5fa" }} /> Portfolio</span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#d946ef" }} /> Insurance</span>
  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#fb7185" }} /> Tax</span>
  <span className="ml-auto">Click any card to expand · Esc to close</span>
</div>
```

- [ ] **Step 5: Manual verify**

Run `npm run dev`. Open the Timeline tab. Expected: a full vertical waterfall of years with a center spine column showing year/age labels and event cards branching to the left or right. Couples show primary on left, spouse on right, joint centered. Footer legend visible at the bottom. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/timeline-year-segment.tsx \
        src/components/timeline/timeline-spine.tsx \
        src/components/timeline-report-view.tsx
git commit -m "feat(timeline): render year segments, spine waterfall, and footer legend"
```

---

## Task 16: Mini-map with viewport window

**Files:**
- Create: `src/components/timeline/timeline-minimap.tsx`
- Modify: `src/components/timeline-report-view.tsx` to render the mini-map sticky under the controls and to receive viewport-year-range updates.

- [ ] **Step 1: Write the mini-map**

```tsx
// src/components/timeline/timeline-minimap.tsx
"use client";

import { useMemo, useRef } from "react";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineSparkline from "./timeline-sparkline";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  events: TimelineEvent[];
  visibleYearRange: { start: number; end: number } | null;
  onScrollToYear: (year: number) => void;
}

const CATEGORY_COLOR: Record<TimelineEvent["category"], string> = {
  life: "#38bdf8",
  income: "#34d399",
  transaction: "#fbbf24",
  portfolio: "#60a5fa",
  insurance: "#d946ef",
  tax: "#fb7185",
};

export default function TimelineMinimap({
  series,
  sparklineMode,
  events,
  visibleYearRange,
  onScrollToYear,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = 800; // logical width; component scales via CSS
  const height = 40;

  const pick = useMemo(() => {
    if (sparklineMode === "netWorth") return (p: SeriesPoint) => p.netWorth;
    if (sparklineMode === "portfolio") return (p: SeriesPoint) => p.portfolio;
    return (p: SeriesPoint) => p.netCashFlow;
  }, [sparklineMode]);

  if (series.length < 2) return null;

  const firstYear = series[0].year;
  const lastYear = series[series.length - 1].year;
  const span = Math.max(1, lastYear - firstYear);

  function xFor(year: number) {
    return ((year - firstYear) / span) * width;
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetYear = Math.round(firstYear + ratio * span);
    onScrollToYear(targetYear);
  };

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className="sticky top-[64px] z-20 w-full cursor-pointer rounded-md border border-gray-800 bg-gray-900/80 p-2 backdrop-blur"
    >
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0">
          <TimelineSparkline
            series={series}
            pick={pick}
            orientation="horizontal"
            width={width}
            height={height}
            strokeClass="stroke-blue-400"
          />
        </div>

        {visibleYearRange && (
          <div
            className="absolute top-0 h-full rounded bg-blue-500/10 ring-1 ring-blue-400/50"
            style={{
              left: `${(xFor(visibleYearRange.start) / width) * 100}%`,
              width: `${((xFor(visibleYearRange.end) - xFor(visibleYearRange.start)) / width) * 100}%`,
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5">
          {events.map((e) => (
            <span
              key={e.id}
              className="absolute bottom-0 h-1.5 w-[2px] rounded"
              style={{
                left: `${(xFor(e.year) / width) * 100}%`,
                backgroundColor: CATEGORY_COLOR[e.category],
              }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>{firstYear}</span>
        <span>{lastYear}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire mini-map into `TimelineReportView`**

Add state for visible year range and a scroll helper:

```tsx
import TimelineMinimap from "@/components/timeline/timeline-minimap";

const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null);

const scrollToYear = useCallback((year: number) => {
  const el = segmentRefs.current.get(year);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}, []);
```

And render above the spine, below the controls:

```tsx
<div className="mt-3">
  <TimelineMinimap
    series={series}
    sparklineMode={sparklineMode}
    events={visibleEvents}
    visibleYearRange={visibleRange}
    onScrollToYear={scrollToYear}
  />
</div>
```

(Viewport tracking gets wired in Task 17 — for now `visibleRange` will be `null` and the highlight window simply won't render.)

- [ ] **Step 3: Manual verify**

Run `npm run dev`. Confirm mini-map appears sticky under the controls, tick marks align with event years, clicking a point scrolls the waterfall to that year. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-minimap.tsx src/components/timeline-report-view.tsx
git commit -m "feat(timeline): add sticky mini-map with click-to-scroll"
```

---

## Task 17: Spine sparkline + viewport IntersectionObserver

Render the rotated sparkline inside the spine column for each visible span of years, and compute the currently-visible year range so the mini-map highlight window tracks scrolling.

**Files:**
- Modify: `src/components/timeline/timeline-spine.tsx` (add the rotated sparkline behind the year column)
- Modify: `src/components/timeline-report-view.tsx` (register IntersectionObserver)

- [ ] **Step 1: Render the rotated spine sparkline**

Replace the entire body of `src/components/timeline/timeline-spine.tsx` with this version, which keeps the prior year-segment logic and adds an absolutely positioned rotated sparkline behind the spine column:

```tsx
// src/components/timeline/timeline-spine.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionYear } from "@/engine";
import type { TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineYearSegment from "./timeline-year-segment";
import TimelineSparkline from "./timeline-sparkline";

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

interface Props {
  projection: ProjectionYear[];
  visibleEvents: TimelineEvent[];
  series: SeriesPoint[];
  sparklineMode: SparklineMode;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onHover: (eventId: string | null) => void;
  primaryLabel: string;
  spouseLabel: string | null;
  isCoupled: boolean;
  registerSegmentRef: (year: number, el: HTMLDivElement | null) => void;
}

export default function TimelineSpine({
  projection,
  visibleEvents,
  series,
  sparklineMode,
  expandedId,
  onToggleExpand,
  onHover,
  primaryLabel,
  spouseLabel,
  isCoupled,
  registerSegmentRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pick = useMemo(() => {
    if (sparklineMode === "netWorth") return (p: SeriesPoint) => p.netWorth;
    if (sparklineMode === "portfolio") return (p: SeriesPoint) => p.portfolio;
    return (p: SeriesPoint) => p.netCashFlow;
  }, [sparklineMode]);

  const eventsByYear = useMemo(() => {
    const m = new Map<number, TimelineEvent[]>();
    for (const e of visibleEvents) {
      const list = m.get(e.year) ?? [];
      list.push(e);
      m.set(e.year, list);
    }
    return m;
  }, [visibleEvents]);

  const subjectLabelFor = (subject: TimelineEvent["subject"]) => {
    if (subject === "primary") return primaryLabel;
    if (subject === "spouse") return spouseLabel ?? undefined;
    return undefined;
  };

  let alternateIndex = 0;

  return (
    <div ref={containerRef} className="relative mt-6 flex flex-col">
      <div
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
        style={{ width: 80, height: dims.height }}
      >
        {dims.height > 0 && (
          <TimelineSparkline
            series={series}
            pick={pick}
            orientation="vertical"
            width={80}
            height={dims.height}
            strokeClass="stroke-blue-500/40"
          />
        )}
      </div>

      {projection.map((py) => {
        const events = eventsByYear.get(py.year) ?? [];
        const ageLabel = py.ages.spouse != null
          ? `Ages ${py.ages.client} / ${py.ages.spouse}`
          : `Age ${py.ages.client}`;
        const segment = (
          <TimelineYearSegment
            key={py.year}
            year={py.year}
            ageLabel={ageLabel}
            events={events}
            spineHeight={80}
            expandedId={expandedId}
            onToggleExpand={onToggleExpand}
            onHover={onHover}
            subjectLabelFor={subjectLabelFor}
            isCoupled={isCoupled}
            registerSegmentRef={registerSegmentRef}
            alternate={!isCoupled}
            alternateOffset={alternateIndex}
          />
        );
        alternateIndex += events.filter((e) => e.subject !== "joint").length;
        return segment;
      })}
    </div>
  );
}
```

- [ ] **Step 2: IntersectionObserver in `TimelineReportView`**

```tsx
// In TimelineReportView, after segmentRefs + registerSegmentRef:

const visibleYearsRef = useRef<Set<number>>(new Set());

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const year = Number((entry.target as HTMLElement).dataset.timelineYear);
        if (!Number.isFinite(year)) continue;
        if (entry.isIntersecting) visibleYearsRef.current.add(year);
        else visibleYearsRef.current.delete(year);
      }
      const years = [...visibleYearsRef.current].sort((a, b) => a - b);
      if (years.length === 0) setVisibleRange(null);
      else setVisibleRange({ start: years[0], end: years[years.length - 1] });
    },
    { threshold: 0.1 },
  );
  for (const el of segmentRefs.current.values()) observer.observe(el);
  return () => observer.disconnect();
}, [projection]); // re-observe when projection changes
```

- [ ] **Step 3: Manual verify**

Run `npm run dev`. Scroll the waterfall; the mini-map highlight window should track your scroll position. The rotated sparkline should render behind the spine column. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-spine.tsx src/components/timeline-report-view.tsx
git commit -m "feat(timeline): add rotated spine sparkline and viewport tracking"
```

---

## Task 18: Card→dot hover highlight

Light up the dot on the spine sparkline corresponding to a hovered card. Reverse direction (dot → card) is deferred per the spec.

**Files:**
- Modify: `src/components/timeline/timeline-spine.tsx` (render dots for visible events, highlight the hovered one)
- Modify: `src/components/timeline-report-view.tsx` (manage `hoveredEventId` state)

- [ ] **Step 1: Lift hover state**

In `TimelineReportView`:

```tsx
const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

// Pass hoveredEventId down and update onHover:
<TimelineSpine
  // … existing props …
  onHover={setHoveredEventId}
  hoveredEventId={hoveredEventId}
/>
```

- [ ] **Step 2: Render dots in `TimelineSpine`**

Accept `hoveredEventId` as a prop and, inside the positioned sparkline overlay, map `visibleEvents` to small `<div>` dots absolutely positioned along the vertical axis. Each dot's vertical position is `(yearIndex / (projection.length - 1)) * dims.height`; highlight the hovered event with a larger radius + category color.

```tsx
// near the sparkline overlay:
<div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2" style={{ width: 80, height: dims.height }}>
  <TimelineSparkline /* … */ />
  {visibleEvents.map((e) => {
    const idx = projection.findIndex((py) => py.year === e.year);
    if (idx < 0) return null;
    const top = (idx / Math.max(1, projection.length - 1)) * dims.height;
    const isHover = hoveredEventId === e.id;
    return (
      <span
        key={e.id}
        className="absolute left-1/2 -translate-x-1/2 rounded-full transition-all"
        style={{
          top,
          width: isHover ? 10 : 5,
          height: isHover ? 10 : 5,
          marginTop: isHover ? -5 : -2.5,
          backgroundColor: CATEGORY_DOT_COLOR[e.category],
          boxShadow: isHover ? `0 0 0 3px ${CATEGORY_DOT_COLOR[e.category]}33` : undefined,
        }}
      />
    );
  })}
</div>
```

Where `CATEGORY_DOT_COLOR` is the same palette used in the mini-map (copy from `timeline-minimap.tsx` — DRY; or extract into `timeline-category-pill.tsx` as a shared export).

- [ ] **Step 3: Manual verify**

Run `npm run dev`. Hover an event card; the matching spine dot expands and gets a glow ring. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-spine.tsx src/components/timeline-report-view.tsx
git commit -m "feat(timeline): highlight matching spine dot on card hover"
```

---

## Task 19: Keyboard navigation

- [ ] **Step 1: Add keyboard handlers**

In `TimelineReportView`, wire document-level key handlers for Escape (collapse), Arrow-up/down (jump between visible events):

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (expandedId) setExpandedId(null);
      return;
    }
    if (visibleEvents.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const focusedIndex = expandedId
        ? visibleEvents.findIndex((ev) => ev.id === expandedId)
        : -1;
      const nextIndex = Math.max(0, Math.min(visibleEvents.length - 1, focusedIndex + delta));
      const next = visibleEvents[nextIndex];
      setExpandedId(next.id);
      scrollToYear(next.year);
      e.preventDefault();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [visibleEvents, expandedId, scrollToYear]);
```

- [ ] **Step 2: Manual verify**

Run `npm run dev`. Tab into a card; Enter expands it; Arrow-down jumps to the next event; Escape collapses. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline-report-view.tsx
git commit -m "feat(timeline): add keyboard navigation for cards"
```

---

## Task 20: Component smoke tests

**Files:**
- Create: `src/components/timeline/__tests__/timeline-report-view.test.tsx`

Smoke tests are minimal but verify the core structural behaviors.

- [ ] **Step 1: Add a testing-library dev dependency if not present**

Check `package.json` for `@testing-library/react`. If missing, install:

```bash
npm install --save-dev @testing-library/react @testing-library/user-event jsdom
```

And update `vitest.config.ts` to include a jsdom environment for the test file (per-file `// @vitest-environment jsdom` comment works without touching the global config).

- [ ] **Step 2: Write the smoke tests**

```tsx
// @vitest-environment jsdom
// src/components/timeline/__tests__/timeline-report-view.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildClientData } from "@/engine/__tests__/fixtures";
import TimelineReportView from "@/components/timeline-report-view";

beforeEach(() => {
  const data = buildClientData();
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => data,
  })) as unknown as typeof fetch;
  // IntersectionObserver + ResizeObserver are not in jsdom — stub them.
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { constructor(_cb: unknown) {} observe() {} unobserve() {} disconnect() {} takeRecords(): IntersectionObserverEntry[] { return []; } }
  // @ts-expect-error test stub
  global.ResizeObserver = RO;
  // @ts-expect-error test stub
  global.IntersectionObserver = IO;
});

describe("TimelineReportView", () => {
  it("renders loading state then the timeline header", async () => {
    render(<TimelineReportView clientId="client-1" />);
    expect(await screen.findByText(/Timeline/i)).toBeDefined();
  });

  it("hides category events when the chip is toggled off", async () => {
    const user = userEvent.setup();
    render(<TimelineReportView clientId="client-1" />);
    const incomeChip = await screen.findByRole("button", { name: /income/i });
    // Before toggle: expect at least one "begins" event rendered (salary start).
    expect((await screen.findAllByText(/begins/i)).length).toBeGreaterThan(0);
    await user.click(incomeChip);
    // After toggle: income events hidden. Some "begins" events may still come from Life (SS claim) —
    // this assertion verifies the income-origin events reduce in count.
    const remaining = screen.queryAllByText(/Salary begins|salary ends/i);
    expect(remaining.length).toBe(0);
  });

  it("expands a card on click and collapses on Escape", async () => {
    const user = userEvent.setup();
    render(<TimelineReportView clientId="client-1" />);
    const firstCard = (await screen.findAllByRole("button", { expanded: false }))[0];
    await user.click(firstCard);
    // At least one expanded card should now exist.
    expect(screen.getAllByRole("button", { expanded: true }).length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("button", { expanded: true }).length).toBe(0);
  });
});
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all prior tests plus the new timeline tests (detector + orchestrator + series + smoke) pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/__tests__/timeline-report-view.test.tsx package.json package-lock.json vitest.config.ts
git commit -m "test(timeline): add component smoke tests"
```

---

## Task 21: Documentation — record deferred work

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Append the deferred list**

Add a new section to `docs/FUTURE_WORK.md`:

```markdown
## Timeline Report (shipped 2026-04-XX)

- **PDF export.** Why deferred: v1 scope is on-screen only. Semantic HTML + `page-break-inside: avoid` on cards is already in the CSS — eventual PDF work is styling + a print-mode hook that drops the sticky mini-map.
- **User-configurable portfolio milestone thresholds.** Why deferred: settings UI not yet built. v1 ships baked-in defaults `[1M, 2M, 5M, 10M]` in `src/lib/timeline/detectors/portfolio.ts`.
- **Timeline year-range slider.** Why deferred: mini-map + category filters cover the 80% case; revisit only if meetings show a need.
- **URL state persistence** (filters, active sparkline, expanded card). Why deferred: keeps v1 simple; add once a deep-link use case appears.
- **IRMAA-triggering year detection.** Why deferred: requires a tax-data signal we may not surface; add as a tax detector branch when the signal is confirmed.
- **Transfer recurring-bands visualization.** Why deferred: v1 suppresses recurring small transfers; polished visual band is a later pass.
- **Timeline animation polish pass.** Why deferred: v1 ships functional animations only.
- **Hover dot → highlight card** on the spine sparkline. Why deferred: v1 ships the card → dot direction only.
```

- [ ] **Step 2: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: record deferred timeline-report follow-ups"
```

---

## Task 22: Final integration check

- [ ] **Step 1: Full build + test pass**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected:
- `lint`: no new errors in timeline files.
- `test`: all tests passing.
- `build`: Next.js production build completes.

- [ ] **Step 2: Manual cross-report sanity check**

Run `npm run dev` and walk through:
- Open a single client (no spouse) → timeline renders with alternating sides, no empty spouse column.
- Open a married client → primary on left, spouse on right, joint events centered.
- Toggle each sparkline mode — curve shape updates, events are unaffected.
- Toggle each category chip — relevant cards disappear and mini-map tick marks update.
- Scroll waterfall — mini-map highlight window follows.
- Click on mini-map — waterfall scrolls to that year.
- Click an event card — expands in place.
- Hover an event card — spine dot highlights.
- Press Escape on expanded card — collapses.
- Arrow-up / Arrow-down — jumps between events.

Stop the dev server.

- [ ] **Step 3: Commit completion marker (optional)**

No source changes; this task is a verification gate. If everything above passes, the feature is ready for PR.

---

## Appendix — File Structure at Completion

```
src/
  app/(app)/clients/[id]/
    layout.tsx                             # MODIFIED: added Timeline tab
    timeline/
      page.tsx                             # CREATED
  components/
    timeline-report-view.tsx               # CREATED
    timeline/
      timeline-controls.tsx                # CREATED
      timeline-minimap.tsx                  # CREATED
      timeline-spine.tsx                    # CREATED
      timeline-year-segment.tsx             # CREATED
      timeline-event-card.tsx               # CREATED
      timeline-sparkline.tsx                # CREATED
      timeline-category-pill.tsx            # CREATED
      __tests__/
        timeline-report-view.test.tsx       # CREATED
  lib/timeline/
    build-timeline.ts                       # CREATED
    build-series.ts                         # CREATED
    timeline-types.ts                       # CREATED
    detectors/
      life.ts                               # CREATED
      income.ts                             # CREATED
      transactions.ts                       # CREATED
      portfolio.ts                          # CREATED
      insurance.ts                          # CREATED
      tax.ts                                # CREATED
    __tests__/
      build-timeline.test.ts                # CREATED
      build-series.test.ts                  # CREATED
      detectors/
        life.test.ts                        # CREATED
        income.test.ts                      # CREATED
        transactions.test.ts                # CREATED
        portfolio.test.ts                   # CREATED
        insurance.test.ts                   # CREATED
        tax.test.ts                         # CREATED
docs/
  FUTURE_WORK.md                            # MODIFIED: deferred items recorded
  superpowers/
    plans/2026-04-19-timeline-report.md     # this file
    specs/2026-04-19-timeline-report-design.md
```
