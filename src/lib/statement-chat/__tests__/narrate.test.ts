import { describe, it, expect } from "vitest";
import { narrate } from "@/lib/statement-chat/narrate";

describe("narrate", () => {
  it("opens with what was read", () => {
    const { summary } = narrate({
      fileCount: 7,
      decisions: [],
      rows: [{ name: "IRA", value: 1 }, { name: "Roth", value: 2 }] as never,
    });
    expect(summary).toBe("Read 7 statements covering 2 accounts.");
  });

  it("says nothing it has no decision for", () => {
    const { summary, caveats } = narrate({
      fileCount: 1,
      decisions: [],
      rows: [{ name: "IRA", value: 1 }] as never,
    });
    expect(summary).toBe("Read 1 statement covering 1 account.");
    expect(caveats).toEqual([]);
  });

  describe("superseded", () => {
    it("names the superseded statement (single dropped date)", () => {
      const { summary } = narrate({
        fileCount: 2,
        decisions: [
          {
            kind: "superseded",
            account: "401(k)",
            kept: "2026-06-30",
            dropped: ["2026-03-31"],
            basis: "date",
          },
        ],
        rows: [{ name: "401(k)", value: 1 }] as never,
      });
      expect(summary).toContain(
        'Used the 06/30/2026 statement for "401(k)"; a 03/31/2026 statement for the same account was superseded.',
      );
    });

    // C5: the brief's template renders a bare count butted against a date
    // list for 2+ dropped dates ("2 03/31/2026, 02/28/2026 statements...").
    // This pins the fixed phrasing for exactly two dropped dates.
    it("names both superseded statements when two dates are dropped", () => {
      const { summary } = narrate({
        fileCount: 3,
        decisions: [
          {
            kind: "superseded",
            account: "401(k)",
            kept: "2026-06-30",
            dropped: ["2026-03-31", "2026-02-28"],
            basis: "date",
          },
        ],
        rows: [{ name: "401(k)", value: 1 }] as never,
      });
      expect(summary).toContain(
        'Used the 06/30/2026 statement for "401(k)"; statements from 03/31/2026 and 02/28/2026 for the same account were superseded.',
      );
    });

    // Oxford-comma join for three or more dropped dates.
    it("joins three or more superseded dates with a final 'and'", () => {
      const { summary } = narrate({
        fileCount: 4,
        decisions: [
          {
            kind: "superseded",
            account: "401(k)",
            kept: "2026-06-30",
            dropped: ["2026-03-31", "2026-02-28", "2026-01-31"],
            basis: "date",
          },
        ],
        rows: [{ name: "401(k)", value: 1 }] as never,
      });
      expect(summary).toContain(
        'Used the 06/30/2026 statement for "401(k)"; statements from 03/31/2026, 02/28/2026, and 01/31/2026 for the same account were superseded.',
      );
    });

    it("says nothing when the basis is field-count, not date", () => {
      const { summary } = narrate({
        fileCount: 2,
        decisions: [
          {
            kind: "superseded",
            account: "401(k)",
            kept: "2026-06-30",
            dropped: ["2026-03-31"],
            basis: "field-count",
          },
        ],
        rows: [{ name: "401(k)", value: 1 }] as never,
      });
      expect(summary).toBe("Read 2 statements covering 1 account.");
    });
  });

  it("names the excluded total and what it covered", () => {
    const { caveats } = narrate({
      fileCount: 1,
      decisions: [{ kind: "rollup-excluded", label: "All Accounts", value: 21_475.2, coversCount: 3 }],
      rows: [] as never,
    });
    expect(caveats).toContain(
      'Excluded "All Accounts" ($21,475) — it is a total covering 3 accounts already listed.',
    );
  });

  describe("retirement basis caveat", () => {
    // Pins the exact wording — including the "not IRS-tracked basis for tax
    // purposes" tail, which reads better than the brief's "not the account's
    // tax basis" and is the wording actually shipped (see the report's
    // Deviations).
    it("flags retirement-account basis as securities cost basis", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [{ name: "Roth IRA", category: "retirement", basis: 10_010.17, value: 22_873.46 }] as never,
      });
      expect(caveats).toContain(
        'For "Roth IRA", the basis shown is the custodian\'s securities cost basis, not IRS-tracked basis for tax purposes.',
      );
    });

    // Fix round 1, Important 3: `r.basis !== undefined` shipped with no test
    // exercising its absence — deleting that clause left all 17 prior tests
    // green. A retirement row with no basis at all must not be flagged.
    it("does not flag a retirement account when no basis is shown", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [{ name: "IRA", category: "retirement", value: 1 }] as never,
      });
      expect(caveats.some((c) => c.includes("securities cost basis"))).toBe(false);
    });

    // Pins the join across multiple retirement rows carrying a basis.
    it("names every retirement account with a basis in one caveat", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [
          { name: "Roth IRA", category: "retirement", basis: 10_010.17, value: 22_873.46 },
          { name: "Traditional IRA", category: "retirement", basis: 5_000, value: 40_000 },
        ] as never,
      });
      const caveat = caveats.find((c) => c.includes("securities cost basis"));
      expect(caveat).toContain('"Roth IRA" and "Traditional IRA"');
    });

    it("does not flag a taxable account that happens to carry a basis", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [{ name: "Brokerage", category: "taxable", basis: 10_000, value: 22_000 }] as never,
      });
      expect(caveats.some((c) => c.includes("securities cost basis"))).toBe(false);
    });
  });

  describe("undated fallback", () => {
    it("discloses the undated fallback for two files", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [{ kind: "undated", account: "IRA", fileNames: ["a.pdf", "b.pdf"] }],
        rows: [] as never,
      });
      expect(caveats.some((c) => c.includes("no readable date"))).toBe(true);
      expect(caveats.some((c) => c.includes("on either"))).toBe(true);
    });

    // Ruling 34: a single document listing the same account twice collapses
    // with fileNames.length === 1. "with no readable date on either" would be
    // ungrammatical (nothing to be "either" of) — must not say "either".
    it("discloses the undated fallback for a single file without saying 'either'", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [{ kind: "undated", account: "IRA", fileNames: ["a.pdf"] }],
        rows: [] as never,
      });
      const caveat = caveats.find((c) => c.includes("no readable date"));
      expect(caveat).toBeDefined();
      expect(caveat).toContain("a.pdf");
      expect(caveat).not.toContain("either");
    });

    // C4: three or more files must not render "on either" (presupposes two)
    // and must join with commas + a final "and".
    it("discloses the undated fallback for three or more files without saying 'either'", () => {
      const { caveats } = narrate({
        fileCount: 3,
        decisions: [{ kind: "undated", account: "IRA", fileNames: ["a.pdf", "b.pdf", "c.pdf"] }],
        rows: [] as never,
      });
      const caveat = caveats.find((c) => c.includes("no readable date"));
      expect(caveat).toBeDefined();
      expect(caveat).toContain("a.pdf, b.pdf, and c.pdf");
      expect(caveat).not.toContain("either");
    });
  });

  describe("value conflict", () => {
    // Fixture rebuilt from decisions.test.ts:97 — a REAL multi-statement
    // conflict `mergeAcrossFiles` can actually produce: three statements,
    // its companion `superseded` decision alongside `value-conflict`, and a
    // populated `rows` array carrying the survivor. Fix round 1: the
    // previous fixture (`rows: []`, no companion `superseded`) was a shape
    // the merge cannot produce, and it let a false sentence — every figure
    // dated to the survivor's statement — test green.
    it("dates only the winning figure, using the row to find it (not by position in values[])", () => {
      const { summary, caveats } = narrate({
        fileCount: 3,
        decisions: [
          {
            kind: "superseded",
            account: "Brokerage",
            kept: "2026-03-31",
            dropped: ["2026-02-28", "2026-01-31"],
            basis: "date",
          },
          {
            kind: "value-conflict",
            account: "Brokerage",
            values: [100_000, 200_000, 300_000],
            asOf: "2026-03-31",
          },
        ],
        rows: [{ name: "Brokerage", value: 300_000 }] as never,
      });
      expect(summary).toContain(
        'Used the 03/31/2026 statement for "Brokerage"; statements from 02/28/2026 and 01/31/2026 for the same account were superseded.',
      );
      expect(caveats).toContain(
        '"Brokerage" is recorded at $300,000 from the 03/31/2026 statement; other statements reported $100,000 and $200,000.',
      );
    });

    // The unresolvable path (Fix round 1, Critical): when no row in `rows`
    // matches the decision's account name — excluded as a rollup, renamed,
    // whatever the reason — there is no derivable winner, so NO figure may
    // be dated. Reusing values/asOf from the original (pre-fix) test fixture.
    it("dates nothing when the account cannot be found among the rows", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          { kind: "value-conflict", account: "Brokerage", values: [102_450, 98_700], asOf: "2026-06-30" },
        ],
        rows: [] as never,
      });
      expect(caveats).toContain(
        '"Brokerage" was reported at $102,450 and $98,700 across these statements; confirm which is current.',
      );
    });
  });

  describe("matched-account caveat", () => {
    // This is the caveat that tells the advisor committing will UPDATE an
    // existing plan account rather than create a new one — it must fire
    // whenever a row carries an exact match, singular wording included.
    it("fires for a single row carrying an exact match", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [
          { name: "IRA", value: 1, match: { kind: "exact", existingId: "acct-1" } },
        ] as never,
      });
      expect(caveats).toContain(
        "1 account matched an existing plan account and will update it rather than create a new one.",
      );
    });

    // Pins the plural branch separately from the singular one above.
    it("pluralizes for two or more rows carrying an exact match", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [
          { name: "IRA", value: 1, match: { kind: "exact", existingId: "acct-1" } },
          { name: "Roth IRA", value: 2, match: { kind: "exact", existingId: "acct-2" } },
        ] as never,
      });
      expect(caveats).toContain(
        "2 accounts matched existing plan accounts and will update them rather than create new ones.",
      );
    });

    // `mergeAcrossFiles` stamps every row `{ kind: "new" }` — the state the
    // chat surface actually produces today, before any matching step runs.
    // The caveat must stay silent for it rather than firing on "new".
    it("does not fire when every row is unmatched ('new')", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [
          { name: "IRA", value: 1, match: { kind: "new" } },
          { name: "Roth IRA", value: 2 },
        ] as never,
      });
      expect(caveats.some((c) => c.includes("matched an existing plan account"))).toBe(false);
      expect(caveats.some((c) => c.includes("matched existing plan accounts"))).toBe(false);
    });
  });
});
