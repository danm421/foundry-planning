import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type { TokenContext } from "@/lib/plan-text/tokens";
import { OBSERVATION_TOPICS } from "@/lib/schemas/observations";
import type { Block, Run } from "../../blank/markdown-blocks";
import { buildObservationsPageData, type ObservationsRowInput } from "../view-model";
import { OBSERVATIONS_PAGE_OPTIONS_DEFAULT } from "../options-schema";

// Fixture ctx mirrors src/lib/plan-text/__tests__/tokens.test.ts — net_worth
// resolves to $2,100,000 (2,500,000 portfolio assets - 400,000 liabilities).
const clientData = {
  client: {
    firstName: "Sam",
    lastName: "Client",
    dateOfBirth: "1971-01-01",
    retirementAge: 65,
    planEndAge: 95,
    spouseName: "Alex",
    filingStatus: "married_joint",
  },
} as unknown as ClientData;

const firstYear = {
  year: 2026,
  ages: { client: 55 },
  totalIncome: 150000,
  expenses: { total: 120000 },
  savings: { total: 30000 },
  portfolioAssets: { total: 2500000, liquidTotal: 1800000 },
  liabilityBalancesBoY: { l1: 400000 },
  hypotheticalEstateTax: {
    year: 2026,
    primaryFirst: { totals: { total: 0 } },
  },
};

const projection = { years: [firstYear] } as unknown as ProjectionResult;

const ctx: TokenContext = { clientData, projection };

function flattenText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const runs: Run[] = b.type === "list" ? b.items.flat() : b.runs;
      return runs.map((r) => r.text).join("");
    })
    .join(" ");
}

// 2 observations across 2 topics (one body carries a {{net_worth}} token) +
// 1 done next step. `estate` intentionally sorts before `cash-flow` in
// `sortOrder` even though `cash-flow` precedes `estate` in OBSERVATION_TOPICS
// — this exercises the canonical-order requirement independent of row order.
const rows: ObservationsRowInput[] = [
  {
    section: "observation",
    topic: "estate",
    title: null,
    body: "Net worth today is {{net_worth}}.",
    status: "open",
    owner: null,
    priority: null,
    targetDate: null,
    sortOrder: 0,
  },
  {
    section: "observation",
    topic: "cash-flow",
    title: null,
    body: "Spending has been stable this year.",
    status: "open",
    owner: null,
    priority: null,
    targetDate: null,
    sortOrder: 1,
  },
  {
    section: "next_step",
    topic: "general",
    title: "Rebalance portfolio",
    body: "Review asset allocation against targets.",
    status: "done",
    owner: "advisor",
    priority: "high",
    targetDate: "2026-08-01",
    sortOrder: 2,
  },
];

describe("buildObservationsPageData", () => {
  it("include: 'observations' yields no next steps", () => {
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, include: "observations" },
    });
    expect(data.nextSteps).toEqual([]);
  });

  it("includeCompleted: false drops the done next step (and includeCompleted: true restores it)", () => {
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, include: "nextSteps", includeCompleted: false },
    });
    expect(data.nextSteps).toEqual([]);

    const withCompleted = buildObservationsPageData({
      rows,
      ctx,
      options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, include: "nextSteps", includeCompleted: true },
    });
    expect(withCompleted.nextSteps).toHaveLength(1);
    expect(withCompleted.nextSteps[0].title).toBe("Rebalance portfolio");
    expect(withCompleted.nextSteps[0].status).toBe("done");
  });

  it("resolves a {{net_worth}} token in an observation body to $2,100,000 in the parsed blocks", () => {
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
    });
    const estateGroup = data.topicGroups.find((g) => g.topic === "estate");
    expect(estateGroup).toBeDefined();
    const text = flattenText(estateGroup!.items[0]);
    expect(text).toContain("$2,100,000");
  });

  it("filters topic groups by the topics option", () => {
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, topics: ["estate"] },
    });
    expect(data.topicGroups.map((g) => g.topic)).toEqual(["estate"]);
  });

  it("orders topic groups per OBSERVATION_TOPICS with human labels", () => {
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: OBSERVATIONS_PAGE_OPTIONS_DEFAULT,
    });
    expect(OBSERVATION_TOPICS.indexOf("cash-flow")).toBeLessThan(OBSERVATION_TOPICS.indexOf("estate"));
    expect(data.topicGroups.map((g) => g.topic)).toEqual(["cash-flow", "estate"]);
    expect(data.topicGroups.map((g) => g.label)).toEqual(["Cash Flow", "Estate"]);
  });
});
