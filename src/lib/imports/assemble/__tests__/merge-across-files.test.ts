import { describe, it, expect } from "vitest";
import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";

describe("mergeAcrossFiles", () => {
  it("collapses the same account seen on two statements (custodian+last4)", () => {
    const r = mergeAcrossFiles({
      f1: er("stmt-jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, category: "retirement" }] }),
      f2: er("stmt-feb.pdf", { accounts: [{ name: "Fidelity 401k", custodian: "fidelity", accountNumberLast4: "1234", value: 455000, category: "retirement", basis: 300000 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // richer row (has basis) wins
    expect(r.payload.accounts[0].basis).toBe(300000);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(true);
    expect(r.mergedFileCount).toBe(2);
  });

  it("keeps two genuinely different accounts at the same custodian", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1111", value: 1, category: "retirement" }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "2222", value: 2, category: "retirement" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  it("does not merge accounts lacking custodian+last4", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
      f2: er("b.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  it("does NOT merge accounts sharing custodian+last4 when owners differ (FIX 5 — client IRA vs spouse IRA)", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 100000, owner: "client" }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 200000, owner: "spouse" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(false);
  });

  it("still merges same custodian+last4+owner accounts, and names both values when they differ materially (FIX 5)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 100000, owner: "client" }] }),
      f2: er("feb.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 250000, owner: "client" }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // Nothing is dropped — the surviving row keeps a real, non-fabricated value.
    expect(typeof r.payload.accounts[0].value).toBe("number");
    const warning = r.payload.warnings.find((w) => w.includes("Merged duplicate account"));
    expect(warning).toBeDefined();
    expect(warning).toContain("100,000");
    expect(warning).toContain("250,000");
  });

  it("merges same custodian+last4+owner accounts within tolerance without the value-conflict wording (FIX 5)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, owner: "client" }] }),
      f2: er("feb.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 452000, owner: "client" }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    const warning = r.payload.warnings.find((w) => w.includes("Merged duplicate account"));
    expect(warning).toBeDefined();
    expect(warning).not.toContain("differ");
  });

  it("collapses the same account across 3+ files into ONE warning, not one per merge (FIX 6)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100000 }] }),
      f2: er("feb.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100200 }] }),
      f3: er("mar.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100400 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    const mergeWarnings = r.payload.warnings.filter((w) => w.includes("Merged duplicate account"));
    // Before FIX 6 this was 2 warnings ("seen in 2 documents." then "seen in
    // 3 documents.") — both slugifying to the SAME conflict-question id.
    expect(mergeWarnings).toHaveLength(1);
    expect(mergeWarnings[0]).toMatch(/seen in 3 documents/);
  });

  it("still merges same custodian+last4 accounts when neither carries an owner (undefined === undefined)", () => {
    const r = mergeAcrossFiles({
      f1: er("stmt-jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000 }] }),
      f2: er("stmt-feb.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 451000 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
  });

  it("unions non-null fields on merge instead of a whole-row swap — the poorer row's unique field survives", () => {
    const r = mergeAcrossFiles({
      // Richer overall (5 fields: name, custodian, last4, value, category +
      // basis = 6), but lacks growthRate.
      f1: er("stmt-jan.pdf", {
        accounts: [
          {
            name: "401k",
            custodian: "Fidelity",
            accountNumberLast4: "1234",
            value: 450000,
            category: "retirement",
            basis: 300000,
          },
        ],
      }),
      // Poorer overall (5 fields), but carries growthRate, which the richer
      // row above does not have.
      f2: er("stmt-feb.pdf", {
        accounts: [
          {
            name: "Fidelity 401k",
            custodian: "fidelity",
            accountNumberLast4: "1234",
            value: 455000,
            growthRate: 0.06,
          },
        ],
      }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // Richer row's field wins the row.
    expect(r.payload.accounts[0].basis).toBe(300000);
    expect(r.payload.accounts[0].category).toBe("retirement");
    // Poorer row's unique field must survive the merge (union, not swap).
    expect(r.payload.accounts[0].growthRate).toBe(0.06);
  });
});

describe("recency-first account dedupe", () => {
  it("keeps the newer statement's balance even when the older row has more fields", () => {
    const r = mergeAcrossFiles({
      f1: er("march.pdf", {
        accounts: [
          {
            name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234",
            owner: "client", value: 44_120, basis: 30_000, growthRate: 0.06,
            statementDate: "2026-03-31",
          },
        ],
      }),
      f2: er("june.pdf", {
        accounts: [
          {
            name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234",
            owner: "client", value: 51_880,
            statementDate: "2026-06-30",
          },
        ],
      }),
    });

    expect(r.payload.accounts).toHaveLength(1);
    // The June balance wins even though the March row is richer.
    expect(r.payload.accounts[0].value).toBe(51_880);
    // The March row's unique field still backfills — nothing is dropped.
    expect(r.payload.accounts[0].basis).toBe(30_000);
  });

  it("prefers a dated row over an undated one", () => {
    const r = mergeAcrossFiles({
      f1: er("undated.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000 }],
      }),
      f2: er("dated.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000, statementDate: "2026-06-30" }],
      }),
    });
    expect(r.payload.accounts[0].value).toBe(12_000);
  });

  it("falls back to field count when neither row carries a date", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000 }],
      }),
      f2: er("b.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000 }],
      }),
    });
    // Unchanged legacy behaviour: the richer row wins.
    expect(r.payload.accounts[0].value).toBe(10_000);
  });

  it("falls back to field count when both dates are equal", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000, statementDate: "2026-06-30" }],
      }),
      f2: er("b.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000, statementDate: "2026-06-30" }],
      }),
    });
    expect(r.payload.accounts[0].value).toBe(10_000);
  });
});

describe("recency ordering only trusts a zero-padded ISO date", () => {
  // `statementDate` is unvalidated model output — `extraction-schema.ts` runs
  // account rows through `z.looseObject({})`, so any string reaches this code.
  // Only zero-padded YYYY-MM-DD sorts correctly as a plain string, so anything
  // else must be treated as UNDATED and fall safe into the field-count path
  // rather than being trusted as an ordering key.

  it("treats a human-readable date as undated instead of ordering by it", () => {
    const r = mergeAcrossFiles({
      f1: er("march.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 44_120, statementDate: "March 31, 2026" }],
      }),
      f2: er("june.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 51_880, basis: 30_000, growthRate: 0.06, statementDate: "June 30, 2026" }],
      }),
    });
    // Ordered as raw strings, "March 31, 2026" > "June 30, 2026" ("M" > "J"),
    // which would hand the win back to the STALER March row. Both dates are
    // unusable, so field count decides — and here June is the richer row.
    expect(r.payload.accounts[0].value).toBe(51_880);
  });

  it("treats an unpadded month as undated, so a well-formed date still wins", () => {
    const r = mergeAcrossFiles({
      f1: er("june.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 20_000, basis: 5_000, statementDate: "2026-6-30" }],
      }),
      f2: er("december.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 30_000, statementDate: "2026-12-31" }],
      }),
    });
    // Ordered as raw strings, "2026-6-30" > "2026-12-31" ("6" > "1"), which
    // would make June beat December. The unpadded value is unusable, so June
    // counts as undated and December's well-formed date wins on its own.
    expect(r.payload.accounts[0].value).toBe(30_000);
  });

});

/**
 * Ruling 120/121. The accounts dedupe key used to be a RAW exact string
 * including `custodian.toLowerCase()`, and the section's `isSameEntity` was
 * the constant `() => true` — which is only ever consulted WITHIN a bucket
 * already found by key. So two spellings of one custodian never met.
 *
 * Measured in a browser: two Fidelity statements for the SAME two accounts
 * produced FOUR committable rows, because the extractor read the custodian
 * as "Fidelity Investments" off one file and "Fidelity" off the other —
 * from fixture headers that are byte-identical. Committing all four
 * double-counted the household by $598,800.
 *
 * Normalizing the key alone does not fix it: `normalizeCustodian` strips
 * only TRAILING legal suffixes, and "Investments" is not one, so
 * "fidelity investments" still !== "fidelity". The custodian has to leave
 * the key and be compared in `isSameEntity`, where `custodianMatches`'
 * whole-word-prefix rule applies.
 */
describe("two spellings of one custodian (Ruling 120)", () => {
  it("collapses 'Fidelity Investments' and 'Fidelity' into ONE row, keeping the newer balance", () => {
    const r = mergeAcrossFiles({
      f1: er("june.pdf", {
        accounts: [{ name: "Joint Brokerage", custodian: "Fidelity Investments", accountNumberLast4: "1234", owner: "client", value: 100_000, statementDate: "2026-06-30" }],
      }),
      f2: er("september.pdf", {
        accounts: [{ name: "Joint Brokerage", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 130_000, statementDate: "2026-09-30" }],
      }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // `recencyOf` still reaches the bucket through the narrower key — the
    // September statement supersedes June rather than a field-count coin
    // flip deciding it.
    expect(r.payload.accounts[0].value).toBe(130_000);
    expect(r.decisions).toContainEqual(
      expect.objectContaining({ kind: "superseded", account: "Joint Brokerage", basis: "date" }),
    );
  });

  // The risk the wider bucket introduces, and the test that proves
  // `isSameEntity` earns its place: without a real custodian comparison a
  // Fidelity statement and a Schwab statement sharing masked digits would
  // now collapse into one account.
  it("keeps two genuinely different custodians apart even when last4 and owner match", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", {
        accounts: [{ name: "Brokerage", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 100_000 }],
      }),
      f2: er("b.pdf", {
        accounts: [{ name: "Brokerage", custodian: "Schwab", accountNumberLast4: "1234", owner: "client", value: 250_000 }],
      }),
    });
    expect(r.payload.accounts).toHaveLength(2);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(false);
  });

  // "fid" is not a whole-word prefix of "fidelity" — `custodianMatches`
  // requires a word boundary, so an abbreviation is not a match.
  it("does not treat a bare abbreviation as the same custodian", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "Fid", accountNumberLast4: "1234", owner: "client", value: 1 }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 2 }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  // A custodian that normalizes to null (absent, or nothing but a legal
  // suffix) never matches a named one — the precedent `rollups.ts` already
  // sets for the same comparison.
  it("does not merge a null-custodian row into a named one", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "LLC", accountNumberLast4: "1234", owner: "client", value: 1 }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 2 }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  // Two rows that BOTH normalize to null share the catch-all and are
  // compared only to each other — same rule as `rollups.ts`.
  it("merges two rows that both normalize to a null custodian", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "LLC", accountNumberLast4: "1234", owner: "client", value: 1 }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Inc.", accountNumberLast4: "1234", owner: "client", value: 2, basis: 1 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
  });

  // FIX 5's property must survive the narrower key: `owner` is still IN it,
  // so a client IRA and a spouse IRA sharing a masked last-4 at the same
  // custodian never even reach the same bucket.
  it("still separates a client IRA from a spouse IRA on owner (FIX 5 survives)", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity Investments", accountNumberLast4: "1234", owner: "client", value: 100_000 }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", owner: "spouse", value: 200_000 }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(false);
  });

  // A row missing either half of the key still gets the null-key fallback
  // id and never merges — unchanged by this.
  it("still refuses to merge a row with no last4", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "Brokerage", custodian: "Fidelity", owner: "client", value: 1 }] }),
      f2: er("b.pdf", { accounts: [{ name: "Brokerage", custodian: "Fidelity", owner: "client", value: 1 }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });
});
