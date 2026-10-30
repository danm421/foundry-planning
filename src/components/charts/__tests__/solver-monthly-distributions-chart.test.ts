import { describe, it, expect } from "vitest";
import type { DistributionMonth, DistributionRow } from "@/lib/solver/monthly-distributions";
import {
  buildDistributionsChartData,
  distributionTooltipLabel,
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
      accounts: accounts.map((a) => ({ ...a, annualNominal: a.amount * 12, borrowed: 0 })),
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
    lifeInsuranceProceeds: 0,
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

/** Twelve months of `r`, every month the average — or as `over` reshapes them. */
function monthsOf(
  r: DistributionRow,
  over: (m: DistributionMonth, i: number) => Partial<DistributionMonth> = () => ({}),
): DistributionMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m: DistributionMonth = {
      month: i + 1,
      label: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i],
      need: r.need.total,
      income: r.income.total,
      taxes: r.taxes,
      accounts: r.fromAccounts.accounts.map((a) => ({ accountId: a.accountId, amount: a.amount })),
      cash: 0,
    };
    return { ...m, ...over(m, i) };
  });
}

const bars = (d: ReturnType<typeof buildDistributionsChartData>) =>
  d.datasets.filter((s) => s.type === "bar");

describe("buildDistributionsChartData", () => {
  it("labels: Income, ranked accounts, no Other when all fit, then Spending need; Jan-Dec", () => {
    const d = buildDistributionsChartData(FEW, monthsOf(FEW[1]), "dark");
    expect(d.datasets.map((s) => s.label)).toEqual([
      "Income",
      "Acct a",
      "Acct b",
      "Acct c",
      "Spending need",
    ]);
    expect(d.labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("adds Other accounts when the year draws from an account without a bar", () => {
    const d = buildDistributionsChartData(MANY, monthsOf(MANY[0]), "dark");
    expect(d.datasets.map((s) => s.label)).toEqual([
      "Income",
      "Acct a",
      "Acct b",
      "Acct c",
      "Acct d",
      "Other accounts",
      "Spending need",
    ]);
    // A year that draws only from ranked accounts has no Other bar.
    const plain = buildDistributionsChartData(MANY, monthsOf(MANY[2]), "dark");
    expect(plain.datasets.map((s) => s.label)).not.toContain("Other accounts");
  });

  it("each month's bars sum to its income + what the accounts and the cushion send", () => {
    const months = monthsOf(MANY[0], (m, i) => ({
      income: m.income + i * 100,
      cash: i === 2 ? -400 : 0,
    }));
    const d = buildDistributionsChartData(MANY, months, "dark");
    months.forEach((m, i) => {
      const sum = bars(d).reduce((s, ds) => s + (ds.data[i] as number), 0);
      expect(sum).toBeCloseTo(m.income + m.accounts.reduce((s, a) => s + a.amount, 0) + m.cash, 6);
    });
  });

  it("shows the cash cushion only when a month uses it, below zero when income is held", () => {
    expect(
      buildDistributionsChartData(FEW, monthsOf(FEW[0]), "dark").datasets.map((s) => s.label),
    ).not.toContain("Cash cushion");
    const d = buildDistributionsChartData(
      FEW,
      monthsOf(FEW[0], (_, i) => ({ cash: i === 2 ? -1_100 : 100 })),
      "dark",
    );
    const cash = d.datasets.find((s) => s.label === "Cash cushion")!;
    expect(cash.data[2]).toBe(-1_100);
    expect(cash.data[0]).toBe(100);
  });

  it("leaves out an account the year doesn't draw from; the others keep their colours", () => {
    const full = buildDistributionsChartData(MANY, monthsOf(MANY[0]), "dark");
    const d = buildDistributionsChartData(MANY, monthsOf(MANY[2]), "dark");
    expect(d.datasets.map((s) => s.label)).toEqual(["Income", "Acct a", "Acct b", "Acct c", "Spending need"]);
    const colour = (data: typeof d, label: string) =>
      (data.datasets.find((s) => s.label === label) as { backgroundColor: string }).backgroundColor;
    for (const label of ["Acct a", "Acct b", "Acct c"]) expect(colour(d, label)).toBe(colour(full, label));
  });

  it("draws the month's need as a dashed stepped line with no points", () => {
    const months = monthsOf(MANY[0], (m, i) => ({ need: i === 7 ? m.need + 30_000 : m.need }));
    const d = buildDistributionsChartData(MANY, months, "dark");
    const line = d.datasets.find((s) => s.label === "Spending need") as unknown as Record<
      string,
      unknown
    >;
    expect(line.type).toBe("line");
    expect(line.data).toEqual(months.map((m) => m.need));
    expect(line.borderDash).toEqual([6, 4]);
    expect(line.stepped).toBe("middle");
    expect(line.pointRadius).toBe(0);
  });

  it("never makes a dataset out of a goal", () => {
    const d = buildDistributionsChartData(FEW, monthsOf(FEW[0]), "dark");
    for (const s of d.datasets) {
      expect(s.label).not.toMatch(/Goal|Lake House|College/);
    }
  });

  it("keeps an account's colour when the rows arrive in another order", () => {
    const colorOf = (rows: DistributionRow[]) =>
      Object.fromEntries(
        buildDistributionsChartData(rows, monthsOf(MANY[0]), "light").datasets.map((s) => [
          s.label,
          (s as { backgroundColor?: string }).backgroundColor,
        ]),
      );
    expect(colorOf([...MANY].reverse())).toEqual(colorOf(MANY));
  });

  it.each(["dark", "light"] as const)("keeps every bar apart to the eye in %s", (theme) => {
    const d = buildDistributionsChartData(
      MANY,
      monthsOf(MANY[0], (_, i) => ({ cash: i === 2 ? -500 : 50 })),
      theme,
    );
    const hexes = bars(d).map((s) => (s as { backgroundColor: string }).backgroundColor);
    expect(hexes).toHaveLength(7);
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
    const other = buildDistributionsChartData(MANY, monthsOf(MANY[0]), theme).datasets.find(
      (s) => s.label === "Other accounts",
    ) as { backgroundColor: string };
    for (const hue of [p.red, p.orange, p.teal, p.purple, p.grey]) {
      expect(other.backgroundColor).not.toBe(hue);
    }
  });
});

describe("distributionTooltipLabel", () => {
  it("names a month's figure without /mo, and says which way the cushion went", () => {
    expect(distributionTooltipLabel("Acct a", 3_000)).toBe("Acct a: $3,000");
    expect(distributionTooltipLabel("Cash cushion", 250)).toBe("From cash cushion: $250");
    expect(distributionTooltipLabel("Cash cushion", -1_100)).toBe("Into cash cushion: $1,100");
  });
});
