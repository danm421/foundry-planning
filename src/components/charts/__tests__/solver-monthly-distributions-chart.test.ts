import { describe, it, expect } from "vitest";
import type { DistributionRow } from "@/lib/solver/monthly-distributions";
import {
  buildDistributionsChartData,
  clickedDistributionYear,
  selectedDistributionIndex,
  distributionTooltipExtras,
} from "../solver-monthly-distributions-chart";
import { data, dataLight } from "@/brand";
import { separation, SEPARATION_FLOOR } from "./color-separation";

type Acct = { accountId: string; name: string; amount: number };

function row(year: number, accounts: Acct[], over: Partial<DistributionRow> = {}): DistributionRow {
  const total = accounts.reduce((s, a) => s + a.amount, 0);
  return {
    year,
    ageLabel: `Age ${year - 1970}`,
    retired: true,
    depleted: false,
    need: {
      living: 7_000,
      liabilities: 1_000,
      realEstate: 300,
      insurance: 200,
      goalLines: [{ expenseId: "g1", name: "Lake House Goal", amount: 500 }],
      other: 100,
      savings: 0,
      total: 9_100,
    },
    income: { total: 4_000, sources: [{ label: "Social Security", amount: 4_000 }] },
    taxes: 1_200,
    fromAccounts: {
      total,
      accounts: accounts.map((a) => ({ ...a, borrowed: 0 })),
      parts: {
        spending: 5_100,
        taxes: 1_200,
        goalShortfall: 0,
        surplusSpent: 0,
        absorbedExtra: 0,
        keptOrReinvested: Math.max(0, total - 6_300),
      },
      unexplained: 0,
    },
    goals: [
      {
        goalId: "g2",
        name: "College Fund Goal",
        setAsideAccountNames: ["529"],
        fromSetAside: 900,
        fromGeneral: 0,
        unfunded: 0,
      },
    ],
    qcds: [],
    ...over,
  };
}

const A = (id: string, amount: number): Acct => ({ accountId: id, name: `Acct ${id}`, amount });

const FEW = [
  row(2040, [A("a", 3_000), A("b", 1_500)]),
  row(2041, [A("a", 3_200), A("b", 1_600), A("c", 100)]),
];
const MANY = [
  row(2040, [A("a", 3_000), A("b", 2_000), A("c", 1_000), A("d", 800), A("e", 300), A("f", 200)]),
  row(2041, [A("a", 3_100), A("b", 2_100), A("c", 900), A("d", 700), A("e", 250)]),
  row(2042, [A("a", 3_100), A("b", 2_100), A("c", 900)]),
];

const bars = (d: ReturnType<typeof buildDistributionsChartData>) =>
  d.datasets.filter((s) => s.type === "bar");

describe("buildDistributionsChartData", () => {
  it("labels: Income, ranked accounts, no Other when all fit, then Spending need", () => {
    const d = buildDistributionsChartData(FEW, "dark");
    expect(d.datasets.map((s) => s.label)).toEqual([
      "Income",
      "Acct a",
      "Acct b",
      "Acct c",
      "Spending need",
    ]);
    expect(d.labels).toEqual(["2040", "2041"]);
  });

  it("adds Other accounts when more accounts exist than get a bar", () => {
    const d = buildDistributionsChartData(MANY, "dark");
    expect(d.datasets.map((s) => s.label)).toEqual([
      "Income",
      "Acct a",
      "Acct b",
      "Acct c",
      "Acct d",
      "Other accounts",
      "Spending need",
    ]);
  });

  it("each year's bars sum to income + fromAccounts.total", () => {
    for (const rows of [FEW, MANY]) {
      const d = buildDistributionsChartData(rows, "dark");
      rows.forEach((r, i) => {
        const sum = bars(d).reduce((s, ds) => s + (ds.data[i] as number), 0);
        expect(sum).toBeCloseTo(r.income.total + r.fromAccounts.total, 6);
      });
    }
  });

  it("uses 0, never undefined, for an account absent in a year", () => {
    const d = buildDistributionsChartData(MANY, "dark");
    const c = d.datasets.find((s) => s.label === "Acct d")!;
    expect(c.data).toEqual([800, 700, 0]);
  });

  it("draws the need as a dashed stepped line with no points", () => {
    const d = buildDistributionsChartData(MANY, "dark");
    const line = d.datasets.find((s) => s.label === "Spending need") as unknown as Record<
      string,
      unknown
    >;
    expect(line.type).toBe("line");
    expect(line.data).toEqual(MANY.map((r) => r.need.total));
    expect(line.borderDash).toEqual([6, 4]);
    expect(line.stepped).toBe("middle");
    expect(line.pointRadius).toBe(0);
  });

  it("never makes a dataset out of a goal", () => {
    const d = buildDistributionsChartData(FEW, "dark");
    for (const s of d.datasets) {
      expect(s.label).not.toMatch(/Goal|Lake House|College/);
    }
  });

  it("keeps an account's colour when the rows arrive in another order", () => {
    const colorOf = (rows: DistributionRow[]) =>
      Object.fromEntries(
        buildDistributionsChartData(rows, "light").datasets.map((s) => [
          s.label,
          (s as { backgroundColor?: string }).backgroundColor,
        ]),
      );
    expect(colorOf([...MANY].reverse())).toEqual(colorOf(MANY));
  });

  it.each(["dark", "light"] as const)("keeps every bar apart to the eye in %s", (theme) => {
    const d = buildDistributionsChartData(MANY, theme);
    const hexes = bars(d).map((s) => (s as { backgroundColor: string }).backgroundColor);
    expect(new Set(hexes).size).toBe(hexes.length);
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        const pair = [hexes[i], hexes[j]];
        expect({ pair, ok: separation(hexes[i], hexes[j]) >= SEPARATION_FLOOR }).toEqual({
          pair,
          ok: true,
        });
      }
    }
  });
});

describe("Other accounts colour", () => {
  it.each(["dark", "light"] as const)("is a neutral, not a semantic hue, in %s", (theme) => {
    const p = theme === "light" ? dataLight : data;
    const other = buildDistributionsChartData(MANY, theme).datasets.find(
      (s) => s.label === "Other accounts",
    ) as { backgroundColor: string };
    for (const hue of [p.red, p.orange, p.teal, p.purple, p.grey]) {
      expect(other.backgroundColor).not.toBe(hue);
    }
  });
});

describe("year index helpers", () => {
  it("maps a click and a selection onto the row's year", () => {
    expect(clickedDistributionYear(FEW, 1)).toBe(2041);
    expect(clickedDistributionYear(FEW, 9)).toBeNull();
    expect(selectedDistributionIndex(FEW, 2041)).toBe(1);
    expect(selectedDistributionIndex(FEW, null)).toBe(-1);
    expect(selectedDistributionIndex(FEW, 1999)).toBe(-1);
  });
});

describe("distributionTooltipExtras", () => {
  it("lists taxes and every non-zero part, with the panel's wording", () => {
    const r = row(2040, [A("a", 7_000)], {
      fromAccounts: {
        total: 7_000,
        accounts: [{ accountId: "a", name: "Acct a", amount: 7_000, borrowed: 0 }],
        parts: {
          spending: 5_100,
          taxes: 1_200,
          goalShortfall: 0,
          surplusSpent: 0,
          absorbedExtra: 0,
          keptOrReinvested: 700,
        },
        unexplained: 0,
      },
    });
    expect(distributionTooltipExtras(r)).toEqual([
      "Taxes: $1,200/mo",
      "From accounts, spending: $5,100/mo",
      "From accounts, taxes: $1,200/mo",
      "From accounts, more than needed — reinvested / kept in cash: $700/mo",
    ]);
  });
});
