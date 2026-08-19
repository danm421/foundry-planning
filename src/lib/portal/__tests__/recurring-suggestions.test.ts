import { it, expect, describe } from "vitest";
import {
  detectRecurringSuggestions,
  normalizeMerchantKey,
  detectCadence,
  clusterByAmount,
  commonPattern,
  displayNameFor,
  type SuggestionTxn,
} from "@/lib/portal/recurring-suggestions";
import { matchesRecurring, type RecurringLike } from "@/lib/portal/recurring-matching";

const TODAY = "2026-08-19";

let seq = 0;
function txn(over: Partial<SuggestionTxn> & { date: string; amount: number }): SuggestionTxn {
  seq += 1;
  return {
    id: `t${seq}`,
    merchantName: "Netflix",
    name: "NETFLIX.COM",
    categoryId: "c-subs",
    ...over,
  };
}

/** Six monthly Netflix charges on the 12th, ending two weeks before TODAY. */
function netflixSeries(amount = 17.99): SuggestionTxn[] {
  return ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
    (date) => txn({ date, amount }),
  );
}

const CATEGORIES = [
  { id: "c-subs", name: "Subscriptions", color: "#2c5fa8", icon: "📺" },
  { id: "c-util", name: "Utilities", color: "#cf6a1f", icon: "💡" },
];

function detect(transactions: SuggestionTxn[], existing: RecurringLike[] = []) {
  return detectRecurringSuggestions({
    transactions,
    existing,
    categories: CATEGORIES,
    today: TODAY,
  });
}

// ---------------------------------------------------------------- normalizeMerchantKey

describe("normalizeMerchantKey", () => {
  it("groups the same merchant across store numbers and phone numbers", () => {
    const a = normalizeMerchantKey({ merchantName: null, name: "NETFLIX.COM 8668790710 CA" });
    const b = normalizeMerchantKey({ merchantName: null, name: "Netflix.com  #1234" });
    expect(a).toBe(b);
  });

  it("prefers the cleaned merchant name over the raw descriptor", () => {
    expect(normalizeMerchantKey({ merchantName: "Netflix", name: "NETFLIX.COM 8668790710" })).toBe(
      "netflix",
    );
  });

  it("keeps distinct merchants that share a first word apart", () => {
    const mktpl = normalizeMerchantKey({ merchantName: null, name: "AMAZON MKTPL US" });
    const prime = normalizeMerchantKey({ merchantName: null, name: "AMAZON PRIME US" });
    expect(mktpl).not.toBe(prime);
  });

  it("keeps a merchant whose whole name is short words — stripping it would erase it", () => {
    expect(normalizeMerchantKey({ merchantName: "AT&T", name: "AT&T PAYMENT" })).toBe("at t");
  });

  it("returns empty for a descriptor with no usable words", () => {
    expect(normalizeMerchantKey({ merchantName: null, name: "#1234 5678" })).toBe("");
  });
});

// ---------------------------------------------------------------- clusterByAmount

describe("clusterByAmount", () => {
  it("splits a coffee run away from a rent payment", () => {
    const clusters = clusterByAmount([5, 5.25, 5.5, 2200, 2200], (n) => n);
    expect(clusters.map((c) => c.length)).toEqual([3, 2]);
  });

  it("keeps a utility bill that drifts within a quarter of itself together", () => {
    const clusters = clusterByAmount([80, 95, 110, 120], (n) => n);
    expect(clusters).toHaveLength(1);
  });

  it("caps a cluster's total spread so one chain cannot swallow everything", () => {
    // Each step is inside the 25% gap rule, but 40 → 140 is a 3.5x spread.
    const clusters = clusterByAmount([40, 48, 58, 70, 84, 101, 121, 140], (n) => n);
    expect(clusters.length).toBeGreaterThan(1);
    for (const c of clusters) {
      expect(Math.max(...c) / Math.min(...c)).toBeLessThanOrEqual(2.5);
    }
  });
});

// ---------------------------------------------------------------- detectCadence

describe("detectCadence", () => {
  it("reads six same-day charges as monthly on that day", () => {
    expect(detectCadence(netflixSeries().map((t) => t.date))).toEqual({
      cadence: "monthly",
      dueDay: 12,
      dueMonth: null,
    });
  });

  it("still calls it monthly when the day wanders, but stops claiming a due day", () => {
    const c = detectCadence(["2026-03-02", "2026-04-14", "2026-05-03", "2026-06-19", "2026-07-08"]);
    expect(c?.cadence).toBe("monthly");
    expect(c?.dueDay).toBeNull();
  });

  it("survives a skipped month — the median gap absorbs the gap", () => {
    const c = detectCadence(["2026-02-12", "2026-03-12", "2026-05-12", "2026-06-12", "2026-07-12"]);
    expect(c?.cadence).toBe("monthly");
    expect(c?.dueDay).toBe(12);
  });

  it("reads two charges a year apart as annual, in that month", () => {
    expect(detectCadence(["2024-11-04", "2025-11-06", "2026-11-05"])).toEqual({
      cadence: "annually",
      dueDay: 5,
      dueMonth: 11,
    });
  });

  it("rejects weekly — the schema has no weekly cadence to offer", () => {
    expect(
      detectCadence(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]),
    ).toBeNull();
  });

  it("rejects two monthly hits — three are needed before we call it a pattern", () => {
    expect(detectCadence(["2026-06-12", "2026-07-12"])).toBeNull();
  });

  it("rejects a scatter of one-off purchases", () => {
    expect(detectCadence(["2026-01-03", "2026-01-19", "2026-05-27", "2026-08-01"])).toBeNull();
  });

  it("counts a repeat on the same day once, so a same-day double charge is not a cadence", () => {
    expect(detectCadence(["2026-08-12", "2026-08-12", "2026-08-12"])).toBeNull();
  });
});

// ---------------------------------------------------------------- displayNameFor

describe("displayNameFor", () => {
  it("uses the cleaned merchant name", () => {
    expect(displayNameFor({ merchantName: "Netflix", name: "NETFLIX.COM 8668790710" })).toBe("Netflix");
  });

  it("refuses a three-letter fragment that would match half the ledger", () => {
    // Real dev-database row: Plaid cleans "SparkFun" down to the merchant "FUN",
    // and a `contains` rule on "FUN" would also claim a REFUND line.
    expect(displayNameFor({ merchantName: "FUN", name: "SparkFun" })).toBe("SparkFun");
  });

  it("keeps a short name that is genuinely the merchant", () => {
    expect(displayNameFor({ merchantName: "IKEA", name: "IKEA 0042 RENTON WA" })).toBe("IKEA");
    expect(displayNameFor({ merchantName: "KFC", name: "RESTAURANT PURCHASE" })).toBe("KFC");
  });
});

// ---------------------------------------------------------------- commonPattern

describe("commonPattern", () => {
  it("uses the shared merchant name when every charge carries the same one", () => {
    expect(commonPattern(["Netflix", "Netflix", "Netflix"])).toBe("Netflix");
  });

  it("falls back to the shared opening words of the raw descriptor", () => {
    expect(
      commonPattern(["PUGET SOUND ENERGY BILLPAY", "PUGET SOUND ENERGY PMT 0091"]),
    ).toBe("PUGET SOUND ENERGY");
  });

  it("trims a trailing partial token so the pattern never ends mid-number", () => {
    expect(commonPattern(["SPOTIFY USA", "SPOTIFYAB STOCKHOLM"])).toBe("SPOTIFY");
    expect(commonPattern(["SAFEWAY 1234 SEATTLE", "SAFEWAY 1299 SEATTLE"])).toBe("SAFEWAY");
  });

  it("gives up rather than return a one-or-two-character pattern", () => {
    expect(commonPattern(["AB CORP", "AC DELCO"])).toBeNull();
  });
});

// ---------------------------------------------------------------- detectRecurringSuggestions

describe("detectRecurringSuggestions", () => {
  it("suggests a monthly subscription with its day, amount, and category", () => {
    const [s, ...rest] = detect(netflixSeries());
    expect(rest).toEqual([]);
    expect(s.name).toBe("Netflix");
    expect(s.cadence).toBe("monthly");
    expect(s.dueDay).toBe(12);
    expect(s.predicted).toBe(17.99);
    expect(s.occurrences).toBe(6);
    expect(s.lastDate).toBe("2026-08-12");
    expect(s.categoryId).toBe("c-subs");
    expect(s.categoryName).toBe("Subscriptions");
    expect(s.categoryIcon).toBe("📺");
  });

  it("hands back a pattern that really does claim every charge it counted", () => {
    // The whole promise of a suggestion is that accepting it captures these
    // transactions. A pattern the amount band or the text misses is a lie.
    const txns = [
      txn({ merchantName: null, name: "PUGET SOUND ENERGY BILLPAY", date: "2026-05-08", amount: 96.2 }),
      txn({ merchantName: null, name: "PUGET SOUND ENERGY PMT 91", date: "2026-06-09", amount: 104.5 }),
      txn({ merchantName: null, name: "Puget Sound Energy Billpay", date: "2026-07-08", amount: 88.4 }),
      txn({ merchantName: null, name: "PUGET SOUND ENERGY PMT 92", date: "2026-08-10", amount: 99.15 }),
    ];
    const [s] = detect(txns);
    expect(s).toBeDefined();
    const asRule: RecurringLike = {
      id: "candidate",
      matchType: s.matchType,
      pattern: s.pattern,
      amountMin: s.amountMin,
      amountMax: s.amountMax,
      cadence: s.cadence,
      dueDay: s.dueDay,
      dueMonth: s.dueMonth,
      categoryId: "c-util",
      createdAt: new Date("2026-08-19T00:00:00Z"),
    };
    for (const t of txns) {
      expect(matchesRecurring(asRule, { ...t })).toBe(true);
    }
    expect(s.occurrences).toBe(4);
  });

  it("stays silent about a merchant an existing recurring already covers", () => {
    const existing: RecurringLike = {
      id: "r-netflix",
      matchType: "contains",
      pattern: "netflix",
      amountMin: 10,
      amountMax: 30,
      cadence: "monthly",
      dueDay: 12,
      dueMonth: null,
      categoryId: "c-subs",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    expect(detect(netflixSeries(), [existing])).toEqual([]);
  });

  it("drops a subscription that stopped while the rest of the spending carried on", () => {
    const cancelled = ["2025-09-05", "2025-10-05", "2025-11-05", "2025-12-05"].map((date) =>
      txn({ merchantName: "Anytime Fitness", name: "ANYTIME FITNESS", date, amount: 42 }),
    );
    expect(detect([...cancelled, ...netflixSeries()]).map((s) => s.name)).toEqual(["Netflix"]);
  });

  it("still suggests when the bank sync is behind, but not what stopped before it", () => {
    // Every charge here predates TODAY by nearly two months. Judging staleness
    // against the calendar would return nothing at all for this client.
    const live = ["2026-04-23", "2026-05-23", "2026-06-23"].map((date) => txn({ date, amount: 17.99 }));
    const cancelled = ["2025-09-05", "2025-10-05", "2025-11-05"].map((date) =>
      txn({ merchantName: "Anytime Fitness", name: "ANYTIME FITNESS", date, amount: 42 }),
    );
    const out = detect([...live, ...cancelled]);
    expect(out.map((s) => s.name)).toEqual(["Netflix"]);
  });

  it("separates two different charges from the same merchant", () => {
    const mixed = [
      ...netflixSeries(17.99),
      ...["2026-04-03", "2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03"].map((date) =>
        txn({ date, amount: 6.99 }),
      ),
    ];
    const out = detect(mixed);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.predicted).sort((a, b) => a - b)).toEqual([6.99, 17.99]);
  });

  it("ignores a merchant with no repeatable rhythm", () => {
    const noise = [
      txn({ merchantName: "Amazon", name: "AMAZON MKTPL", date: "2026-06-02", amount: 41.2 }),
      txn({ merchantName: "Amazon", name: "AMAZON MKTPL", date: "2026-06-09", amount: 44 }),
      txn({ merchantName: "Amazon", name: "AMAZON MKTPL", date: "2026-06-27", amount: 39.5 }),
      txn({ merchantName: "Amazon", name: "AMAZON MKTPL", date: "2026-08-01", amount: 43.1 }),
    ];
    expect(detect(noise)).toEqual([]);
  });

  it("picks the category the client used most, and reports none when they never picked one", () => {
    const uncategorized = netflixSeries().map((t) => ({ ...t, categoryId: null }));
    const [s] = detect(uncategorized);
    expect(s.categoryId).toBeNull();
    expect(s.categoryName).toBeNull();

    const mostly = netflixSeries().map((t, i) => ({ ...t, categoryId: i === 0 ? "c-util" : "c-subs" }));
    expect(detect(mostly)[0].categoryId).toBe("c-subs");
  });

  it("ranks a same-day charge above one that wanders — the date is the signal", () => {
    // Both are six charges of one unchanging amount, so occurrence count and
    // amount steadiness are tied. Only the day-of-month separates them.
    const wobbly = ["2026-03-02", "2026-04-17", "2026-05-05", "2026-06-21", "2026-07-09", "2026-08-14"].map(
      (date) => txn({ merchantName: "City Water", name: "CITY WATER UTIL", date, amount: 60 }),
    );
    const out = detect([...wobbly, ...netflixSeries()]);
    expect(out.map((s) => s.name)).toEqual(["Netflix", "City Water"]);
    expect(out[0].dueDay).toBe(12);
    expect(out[1].dueDay).toBeNull();
  });

  it("gives each suggestion a key that survives a re-run", () => {
    const first = detect(netflixSeries());
    const second = detect([...netflixSeries()].reverse());
    expect(second.map((s) => s.key)).toEqual(first.map((s) => s.key));
    expect(first[0].key).toBeTruthy();
  });

  it("honours the limit so the list cannot run away", () => {
    const many: SuggestionTxn[] = [];
    for (let m = 0; m < 8; m++) {
      for (const date of ["2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05"]) {
        many.push(
          txn({ merchantName: `Merchant ${m}`, name: `MERCHANT ${m}`, date, amount: 20 + m * 40 }),
        );
      }
    }
    expect(detectRecurringSuggestions({
      transactions: many, existing: [], categories: CATEGORIES, today: TODAY, limit: 3,
    })).toHaveLength(3);
  });

  it("predicts the typical charge, not one dragged up by an unusual month", () => {
    const dates = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"];
    const withOutlier = dates.map((date, i) => txn({ date, amount: i === 5 ? 60 : 50 }));
    const [s] = detect(withOutlier);
    expect(s.predicted).toBe(50);
    expect(s.occurrences).toBe(6);
  });

  it("widens the amount band past the observed range so a price rise still matches", () => {
    const [s] = detect(netflixSeries(17.99));
    expect(s.amountMin).toBeLessThan(17.99);
    expect(s.amountMax).toBeGreaterThan(17.99);
  });

  it("shows the most recent charges as evidence, newest first", () => {
    const [s] = detect(netflixSeries());
    expect(s.sample.map((x) => x.date)).toEqual(["2026-08-12", "2026-07-12", "2026-06-12"]);
    expect(s.sample[0].amount).toBe(17.99);
  });
});
