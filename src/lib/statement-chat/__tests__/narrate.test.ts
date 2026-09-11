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
    it("dates only the winning figure, taken straight from the decision's `kept`", () => {
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
            kept: 300_000,
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

    // Fix round 2: the field-count tiebreak (`chooseBase`) can make the
    // winner NOT the chronologically-last statement — fixture rebuilt from
    // decisions.test.ts:130-155 ("stays silent when both statements carry
    // the SAME date"). Equal dates fall through to field count, and the
    // richer row ($10,000, which also carries `basis`) wins even though
    // $12,000 is not earlier. This is also the only fixture with exactly
    // ONE other figure, pinning the singular "another statement" branch.
    it("names the field-count tiebreak's winner, not whichever figure sorts last", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          { kind: "value-conflict", account: "IRA", values: [10_000, 12_000], asOf: "2026-06-30", kept: 10_000 },
        ],
        rows: [] as never,
      });
      expect(caveats).toContain(
        '"IRA" is recorded at $10,000 from the 06/30/2026 statement; another statement reported $12,000.',
      );
      expect(caveats).not.toContain(
        '"IRA" is recorded at $12,000 from the 06/30/2026 statement; another statement reported $10,000.',
      );
    });

    // Regression test for the Important finding introduced by fix round 1:
    // an earlier version looked the winner up via `rows.find(r => r.name ===
    // d.account)`, which returns the FIRST name match — wrong whenever two
    // different accounts share a display name (a client IRA and a spouse
    // IRA). `rows` isn't even read for this decision kind anymore, so this
    // passes by construction now; mutation-confirmed below that it fails
    // against the old lookup-based implementation.
    it("names each account's own winner when two accounts share a display name", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          { kind: "value-conflict", account: "IRA", values: [10_000, 15_000], asOf: "2026-06-30", kept: 15_000 },
          { kind: "value-conflict", account: "IRA", values: [20_000, 25_000], asOf: "2026-06-30", kept: 25_000 },
        ],
        rows: [
          { name: "IRA", owner: "client", value: 15_000 },
          { name: "IRA", owner: "spouse", value: 25_000 },
        ] as never,
      });
      expect(caveats).toContain(
        '"IRA" is recorded at $15,000 from the 06/30/2026 statement; another statement reported $10,000.',
      );
      expect(caveats).toContain(
        '"IRA" is recorded at $25,000 from the 06/30/2026 statement; another statement reported $20,000.',
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

  /**
   * Ruling 117. A re-extraction that finds a NEWER figure for a row the
   * advisor has already been working on keeps the advisor's figure on
   * screen — and now says so, naming both.
   *
   * The measured failure: the table showed $100,000 while the caveat
   * directly above it named $130,000, because the route narrated the FRESH
   * decisions against the REBASED rows.
   */
  describe("rebase-override caveat", () => {
    it("names both figures and says which one will commit", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [],
        rows: [{ name: "Joint Brokerage", value: 100_000 }] as never,
        overrides: [
          {
            __rowId: "account:1",
            name: "Joint Brokerage",
            freshName: "Joint Brokerage",
            standingValue: 100_000,
            freshValue: 130_000,
          },
        ],
      });
      expect(caveats).toContain(
        '"Joint Brokerage" is shown at $100,000 — the figure already on this import, and the one ' +
          "that will commit. The newly uploaded statement reports $130,000. Edit the row if the " +
          "newer figure is the one you want.",
      );
    });

    it("says 'no value' rather than fabricating a figure when one side has none", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [],
        rows: [{ name: "IRA" }] as never,
        overrides: [
          { __rowId: "account:1", name: "IRA", freshName: "IRA", standingValue: undefined, freshValue: 130_000 },
        ],
      });
      expect(caveats).toContain(
        '"IRA" is shown at no value — the figure already on this import, and the one that will ' +
          "commit. The newly uploaded statement reports $130,000. Edit the row if the newer figure " +
          "is the one you want.",
      );
    });

    /**
     * Final review #2, C-1. When the rebase REFUSES to carry a standing row
     * forward, nothing is overwritten — but nothing is applied either, and a
     * silent non-application reads as a dead button. The caveat names both
     * the label the advisor has been looking at and the account that now
     * holds that row, and says what to do about it.
     *
     * Mutation this catches: dropping the `refusals` loop from `narrate`
     * (the guard would then refuse silently, which is half the defect it
     * exists to close).
     */
    it("names both accounts when the rebase refuses to carry a row forward", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [],
        rows: [{ name: "Schwab Brokerage", value: 88_000 }] as never,
        refusals: [
          {
            __rowId: "account:7734#0",
            name: "Fidelity Roth IRA",
            freshName: "Schwab Brokerage",
          },
        ],
      });
      expect(caveats).toEqual([
        'Your changes to "Fidelity Roth IRA" were not carried onto the re-read statements: ' +
          'after the new upload that row\'s place is held by a different account, ' +
          '"Schwab Brokerage". Nothing was overwritten — re-apply the change on the row you want.',
      ]);
    });

    it("stays silent when there are no overrides", () => {
      const { caveats } = narrate({
        fileCount: 1,
        decisions: [],
        rows: [{ name: "IRA", value: 1 }] as never,
        overrides: [],
      });
      expect(caveats).toEqual([]);
    });

    /**
     * THE contradiction, pinned. `mergeAcrossFiles` correctly emits a
     * `value-conflict` naming $130,000 as the figure it kept — but the
     * rebase then held that figure back, so the table shows $100,000. Both
     * caveats rendering together tells the advisor the merge landed on
     * $130,000 above a row reading $100,000.
     *
     * The override caveat replaces it: same two numbers, honest about which
     * one is on screen.
     */
    it("suppresses the value-conflict caveat naming the figure the rebase discarded", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          {
            kind: "value-conflict",
            account: "Joint Brokerage",
            values: [100_000, 130_000],
            asOf: "2026-09-30",
            kept: 130_000,
          },
        ],
        rows: [{ name: "Joint Brokerage", value: 100_000 }] as never,
        overrides: [
          {
            __rowId: "account:1",
            name: "Joint Brokerage",
            freshName: "Joint Brokerage",
            standingValue: 100_000,
            freshValue: 130_000,
          },
        ],
      });
      expect(caveats.some((c) => c.includes("is recorded at $130,000"))).toBe(false);
      expect(caveats).toEqual([
        '"Joint Brokerage" is shown at $100,000 — the figure already on this import, and the one ' +
          "that will commit. The newly uploaded statement reports $130,000. Edit the row if the " +
          "newer figure is the one you want.",
      ]);
    });

    // The suppression is targeted, not a blanket mute: another account's
    // value-conflict on the same run still renders in full.
    it("leaves an unrelated account's value-conflict caveat alone", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          {
            kind: "value-conflict",
            account: "Joint Brokerage",
            values: [100_000, 130_000],
            asOf: "2026-09-30",
            kept: 130_000,
          },
          {
            kind: "value-conflict",
            account: "Roth IRA",
            values: [40_000, 50_000],
            asOf: "2026-09-30",
            kept: 50_000,
          },
        ],
        rows: [
          { name: "Joint Brokerage", value: 100_000 },
          { name: "Roth IRA", value: 50_000 },
        ] as never,
        overrides: [
          {
            __rowId: "account:1",
            name: "Joint Brokerage",
            freshName: "Joint Brokerage",
            standingValue: 100_000,
            freshValue: 130_000,
          },
        ],
      });
      expect(caveats).toContain(
        '"Roth IRA" is recorded at $50,000 from the 09/30/2026 statement; another statement reported $40,000.',
      );
    });

    /**
     * The join is `account` name AND the discarded figure, not the name
     * alone — `valueConflictCaveat`'s own docstring warns that two accounts
     * can share a display name. A same-named account whose kept figure is
     * NOT the one the rebase held back still gets its caveat.
     */
    it("does not mute a same-named account whose kept figure was not the one held back", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          { kind: "value-conflict", account: "IRA", values: [10_000, 15_000], asOf: "2026-06-30", kept: 15_000 },
          { kind: "value-conflict", account: "IRA", values: [20_000, 25_000], asOf: "2026-06-30", kept: 25_000 },
        ],
        rows: [
          { name: "IRA", owner: "client", value: 9_000 },
          { name: "IRA", owner: "spouse", value: 25_000 },
        ] as never,
        overrides: [
          { __rowId: "account:1", name: "IRA", freshName: "IRA", standingValue: 9_000, freshValue: 15_000 },
        ],
      });
      // The client IRA's conflict is the one that was discarded — muted.
      expect(caveats.some((c) => c.includes("is recorded at $15,000"))).toBe(false);
      // The spouse IRA's is untouched.
      expect(caveats).toContain(
        '"IRA" is recorded at $25,000 from the 06/30/2026 statement; another statement reported $20,000.',
      );
    });

    /**
     * Ruling 128 — the Ruling 117 Critical, re-opened by a RENAME.
     *
     * `o.name` is the STANDING row's name; `d.account` is the FRESH
     * survivor's. `name` is editable and a rename survives the rebase by
     * construction, so the moment the advisor renames a row and then
     * uploads a newer statement the two stop matching, the suppression
     * misses, and the screen shows "«old name» is recorded at $130,000"
     * directly above a table row reading $100,000 — while the override
     * caveat renders the SAME row under its NEW name at the standing
     * figure. Carrying the fresh name on the override and matching either
     * one closes it.
     */
    it("suppresses the value-conflict caveat when the advisor has RENAMED the row (Ruling 128)", () => {
      const { caveats } = narrate({
        fileCount: 2,
        decisions: [
          {
            kind: "value-conflict",
            // The FRESH survivor's name — what the merge emitted, and what
            // the advisor's rename replaced on screen.
            account: "Joint Brokerage",
            values: [100_000, 130_000],
            asOf: "2026-09-30",
            kept: 130_000,
          },
        ],
        rows: [{ name: "Schwab Joint — taxable", value: 100_000 }] as never,
        overrides: [
          {
            __rowId: "account:1",
            name: "Schwab Joint — taxable",
            freshName: "Joint Brokerage",
            standingValue: 100_000,
            freshValue: 130_000,
          },
        ],
      });
      expect(caveats.some((c) => c.includes("is recorded at $130,000"))).toBe(false);
      // Only the override caveat, and it still labels the row by the name
      // the advisor gave it — that is the label on screen.
      expect(caveats).toEqual([
        '"Schwab Joint — taxable" is shown at $100,000 — the figure already on this import, and ' +
          "the one that will commit. The newly uploaded statement reports $130,000. Edit the row " +
          "if the newer figure is the one you want.",
      ]);
    });
  });
});
