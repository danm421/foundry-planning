// src/domain/forge/__tests__/grounding.test.ts
import { describe, it, expect } from "vitest";
import { findUngroundedNumbers, containsNumber } from "../grounding";

// Fixed mock plan: the exact JSON payloads run_projection + run_monte_carlo
// would return for this client/scenario.
const PROJECTION_PAYLOAD = JSON.stringify({
  scenarioId: "scn-1",
  taxGrounded: true,
  years: [
    { year: 2025, totalIncome: 100000, totalExpenses: 80000, netCashFlow: 20000, totalTax: 18000 },
    { year: 2026, totalIncome: 102000, totalExpenses: 81000, netCashFlow: 21000, totalTax: 18500 },
  ],
});
const MC_PAYLOAD = JSON.stringify({
  available: true,
  successRate: 0.92,
  endingDistribution: { p50: 2500000 },
});
const PAYLOADS = [PROJECTION_PAYLOAD, MC_PAYLOAD];

describe("grounding — anti-hallucination guard", () => {
  it("passes a faithful answer (every number traces to a payload)", () => {
    const answer =
      "In 2025 your income is $100,000 against $80,000 of expenses, leaving $20,000 of net " +
      "cash flow after $18,000 of tax. By 2026 income rises to $102,000. Your probability of " +
      "success is 92%, with a median ending portfolio around $2.5M.";
    expect(findUngroundedNumbers(answer, PAYLOADS)).toEqual([]);
  });

  it("flags a fabricated figure not present in any payload", () => {
    const answer =
      "Your plan funds a $250,000 annual lifestyle with a 97% probability of success.";
    const ungrounded = findUngroundedNumbers(answer, PAYLOADS);
    // 250000 and 97% are invented; neither appears in the payloads.
    expect(ungrounded).toContain("250,000");
    expect(ungrounded).toContain("97%");
  });

  it("treats year labels and plain integers as grounded when they appear in a payload", () => {
    const answer = "Across 2025 and 2026 your net cash flow stays above $20,000.";
    expect(findUngroundedNumbers(answer, PAYLOADS)).toEqual([]);
  });

  it("flags a fabricated percentage even when its integer appears as an unrelated payload value", () => {
    const payloads = [JSON.stringify({ fundCount: 12, successRate: 0.92 })];
    const ungrounded = findUngroundedNumbers("Your fees run about 12% a year.", payloads);
    expect(ungrounded).toContain("12%");
  });

  it("grounds a percentage whose decimal form is in the payload", () => {
    const payloads = [JSON.stringify({ successRate: 0.92 })];
    expect(findUngroundedNumbers("Probability of success is 92%.", payloads)).toEqual([]);
  });

  it("grounds a correctly-rounded percentage (0.923 payload → '92%')", () => {
    const payloads = [JSON.stringify({ successRate: 0.923 })];
    expect(findUngroundedNumbers("Your probability of success is 92%.", payloads)).toEqual([]);
  });
  it("grounds a magnitude-rounded dollar figure (1242000.5 payload → '$1.2M')", () => {
    const payloads = [JSON.stringify({ p50: 1242000.5 })];
    expect(findUngroundedNumbers("Median ending wealth is about $1.2M.", payloads)).toEqual([]);
  });
  it("still flags a fabricated figure even with tolerance on", () => {
    const payloads = [JSON.stringify({ successRate: 0.92, p50: 2500000 })];
    const u = findUngroundedNumbers("A $1.7M portfolio with a 71% success rate.", payloads);
    expect(u).toContain("1.7M");
    expect(u).toContain("71%");
  });
});

// ─── Task 25: CRM composite skill grounding guard ───────────────────────────
//
// Verify that the suggest_tasks and meeting_prep JSON payloads contain ONLY
// numeric tokens traceable to their seeded inputs. rmdAge=73 is a sanctioned
// domain label constant (spec §7) and is explicitly included in the allowed set.
// No dollar figures or percentages may be invented by either skill.

describe("CRM composite skills — grounding (no fabricated figures)", () => {
  // Seeded inputs that the tools' gatherMeetingBattery would derive from
  const SEEDED_YEARS_TO_RETIREMENT = 8;
  const SEEDED_PORTFOLIO_TOTAL = 425000;
  const SEEDED_ALERT_COUNT = 2;
  const SEEDED_OPEN_TASK_COUNT = 3;
  const RMD_AGE = 73; // domain constant (spec §7) — always allowed

  // Inputs payload: the union of all seeded numeric values
  const SEEDED_PAYLOADS = [
    JSON.stringify({
      yearsToRetirement: SEEDED_YEARS_TO_RETIREMENT,
      portfolioTotal: SEEDED_PORTFOLIO_TOTAL,
      alertCount: SEEDED_ALERT_COUNT,
      openTaskCount: SEEDED_OPEN_TASK_COUNT,
      rmdAge: RMD_AGE,
    }),
  ];

  it("suggest_tasks output contains only grounded numbers (rmdAge 73 is a domain constant)", () => {
    // Simulate the JSON payload suggest_tasks emits for the seeded inputs.
    // IDs use non-numeric strings so array-index digits don't leak as ungrounded tokens.
    const payload = JSON.stringify({
      signals: {
        alerts: [{ id: "alert-a" }, { id: "alert-b" }], // SEEDED_ALERT_COUNT = 2 objects
        yearsToRetirement: SEEDED_YEARS_TO_RETIREMENT,
        rmdAge: RMD_AGE,
        lastMeetingDate: null,
        openTaskCount: SEEDED_OPEN_TASK_COUNT,
      },
      proposedTasks: [
        {
          title: "Review and address current alerts",
          rationale: `${SEEDED_ALERT_COUNT} active alert(s) require advisor attention.`,
        },
        {
          title: "Follow up on open tasks",
          rationale: `${SEEDED_OPEN_TASK_COUNT} open task(s) pending.`,
        },
      ],
      observations: [
        "These are suggested descriptors for advisor review. Advisor judgment required before creating tasks.",
      ],
    });

    const ungrounded = findUngroundedNumbers(payload, SEEDED_PAYLOADS);
    expect(ungrounded).toEqual([]);
  });

  it("meeting_prep output contains only grounded numbers (no invented dollar/percent figures)", () => {
    // Simulate the JSON payload meeting_prep emits for the seeded inputs.
    // IDs use non-numeric strings to avoid spurious ungrounded-token failures.
    const payload = JSON.stringify({
      recentNotes: [],
      openTasks: [{ id: "task-a" }, { id: "task-b" }, { id: "task-c" }], // SEEDED_OPEN_TASK_COUNT = 3
      alerts: [{ id: "alert-a" }, { id: "alert-b" }], // SEEDED_ALERT_COUNT = 2
      lastMeetingDate: null,
      portfolioTotal: SEEDED_PORTFOLIO_TOTAL,
      yearsToRetirement: SEEDED_YEARS_TO_RETIREMENT,
      observations: [],
    });

    const ungrounded = findUngroundedNumbers(payload, SEEDED_PAYLOADS);
    expect(ungrounded).toEqual([]);
  });

  it("flags a figure that is NOT in the seeded inputs (confirms the guard is effective)", () => {
    // A fabricated dollar figure absent from seeded payloads should be flagged.
    // JSON.stringify emits the raw integer (no commas), so findUngroundedNumbers
    // returns the raw token "999999" for a payload value of 999999.
    const fabricatedPayload = JSON.stringify({ portfolioTotal: 999999 });
    const ungrounded = findUngroundedNumbers(fabricatedPayload, SEEDED_PAYLOADS);
    expect(ungrounded).toContain("999999");
  });
});

describe("containsNumber", () => {
  it("detects money, percent, M-suffix, and plain integers", () => {
    expect(containsNumber("funds through age 95")).toBe(true);
    expect(containsNumber("a $2.5M nest egg")).toBe(true);
    expect(containsNumber("92% probability of success")).toBe(true);
    expect(containsNumber("$100,000 of income")).toBe(true);
  });
  it("is false for prose with no figures", () => {
    expect(containsNumber("The plan is on track and well funded.")).toBe(false);
    expect(containsNumber("")).toBe(false);
  });
});
