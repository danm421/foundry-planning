import { describe, it, expect } from "vitest";
import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";

describe("merge decision log", () => {
  it("records which statement won and which was superseded", () => {
    const result = mergeAcrossFiles({
      f1: er("march.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 44_120, statementDate: "2026-03-31" }],
      }),
      f2: er("june.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 51_880, statementDate: "2026-06-30" }],
      }),
    });

    expect(result.decisions).toContainEqual({
      kind: "superseded",
      account: "401(k)",
      kept: "2026-06-30",
      dropped: ["2026-03-31"],
      basis: "date",
    });
  });

  it("records an undated collapse so the narrator can disclose the fallback", () => {
    const result = mergeAcrossFiles({
      f1: er("a.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000 }],
      }),
      f2: er("b.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000 }],
      }),
    });

    expect(result.decisions).toContainEqual({
      kind: "undated",
      account: "IRA",
      fileNames: ["a.pdf", "b.pdf"],
    });
  });

  it("emits no decisions when nothing collapsed", () => {
    const result = mergeAcrossFiles({
      f1: er("one.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000 }],
      }),
    });
    expect(result.decisions).toEqual([]);
  });

  it("stays silent when only ONE statement in the bucket carries a usable date", () => {
    // With a single distinct date `chooseBase` never ordered by date at all,
    // so `superseded` would be a lie — and `undated` would be a lie in the
    // other direction, since one row DOES carry a date. Neither arm is true,
    // so nothing is emitted. The divergence is still disclosed: the wizard's
    // "Merged duplicate account" warning fires, and so does `value-conflict`.
    const result = mergeAcrossFiles({
      f1: er("undated.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000 }],
      }),
      f2: er("dated.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000, statementDate: "2026-06-30" }],
      }),
    });

    expect(result.decisions.some((d) => d.kind === "superseded")).toBe(false);
    expect(result.decisions.some((d) => d.kind === "undated")).toBe(false);
    expect(result.decisions).toContainEqual({
      kind: "value-conflict",
      account: "IRA",
      values: [10_000, 12_000],
      asOf: "2026-06-30",
    });
  });

  it("treats an unorderable date as undated and never names it as the winner", () => {
    // `statementDate` is unvalidated model output. "March 31, 2026" sorts
    // ahead of "June 30, 2026" as a raw string, so recording the raw value
    // would make the log name a statement the merge did NOT keep.
    const result = mergeAcrossFiles({
      f1: er("march.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 44_120, statementDate: "March 31, 2026" }],
      }),
      f2: er("june.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 51_880, statementDate: "June 30, 2026" }],
      }),
    });

    expect(result.decisions).toContainEqual({
      kind: "undated",
      account: "401(k)",
      fileNames: ["march.pdf", "june.pdf"],
    });
    expect(result.decisions.some((d) => d.kind === "superseded")).toBe(false);
    expect(JSON.stringify(result.decisions)).not.toContain("March 31, 2026");
    // The winner carries no orderable date, so there is no truthful `asOf`.
    expect(result.decisions.some((d) => d.kind === "value-conflict")).toBe(false);
  });

  it("carries every distinct figure across three statements, newest date first", () => {
    const result = mergeAcrossFiles({
      f1: er("jan.pdf", {
        accounts: [{ name: "Brokerage", custodian: "Schwab", accountNumberLast4: "9911", owner: "client", value: 100_000, statementDate: "2026-01-31" }],
      }),
      f2: er("feb.pdf", {
        accounts: [{ name: "Brokerage", custodian: "Schwab", accountNumberLast4: "9911", owner: "client", value: 200_000, statementDate: "2026-02-28" }],
      }),
      f3: er("mar.pdf", {
        accounts: [{ name: "Brokerage", custodian: "Schwab", accountNumberLast4: "9911", owner: "client", value: 300_000, statementDate: "2026-03-31" }],
      }),
    });

    expect(result.decisions).toContainEqual({
      kind: "superseded",
      account: "Brokerage",
      kept: "2026-03-31",
      dropped: ["2026-02-28", "2026-01-31"],
      basis: "date",
    });
    // The February figure is seen twice (as the incoming row, then as the
    // surviving row the March statement conflicts with) but listed once.
    expect(result.decisions).toContainEqual({
      kind: "value-conflict",
      account: "Brokerage",
      values: [100_000, 200_000, 300_000],
      asOf: "2026-03-31",
    });
  });

  it("stays silent when both statements carry the SAME date", () => {
    // One DISTINCT date, reached the other way: `chooseBase` sees equal dates
    // and falls straight through to field count (`:168` — the `!==` guard), so
    // `basis: "date"` would be a lie. Counting raw dates instead of distinct
    // ones would emit kept "2026-06-30" / dropped ["2026-06-30"] and narrate
    // "a 06/30/2026 statement ... was superseded" — the same date twice.
    const result = mergeAcrossFiles({
      f1: er("a.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 10_000, basis: 5_000, statementDate: "2026-06-30" }],
      }),
      f2: er("b.pdf", {
        accounts: [{ name: "IRA", custodian: "Schwab", accountNumberLast4: "9999", owner: "client", value: 12_000, statementDate: "2026-06-30" }],
      }),
    });

    expect(result.decisions.some((d) => d.kind === "superseded")).toBe(false);
    expect(result.decisions.some((d) => d.kind === "undated")).toBe(false);
    // Two genuinely different figures both as of the same day IS a conflict,
    // and it is still disclosed.
    expect(result.decisions).toContainEqual({
      kind: "value-conflict",
      account: "IRA",
      values: [10_000, 12_000],
      asOf: "2026-06-30",
    });
  });

  it("does not raise a value conflict when only ONE side has a figure", () => {
    // `withinTolerance` returns false when exactly one side is undefined
    // (deliberately conservative), so the conflict note fires — but there is
    // only one number to show. "Reported as $100,000 as of 06/30/2026,
    // confirm which is current" discloses no conflict and offers no choice.
    // The shipped warning handles this honestly ("$100,000 vs unknown"); the
    // decision channel must not be less truthful than the one it parallels.
    const result = mergeAcrossFiles({
      f1: er("dated.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client", value: 100_000, statementDate: "2026-06-30" }],
      }),
      f2: er("no-balance.pdf", {
        accounts: [{ name: "401(k)", custodian: "Fidelity", accountNumberLast4: "1234", owner: "client" }],
      }),
    });

    expect(result.decisions.some((d) => d.kind === "value-conflict")).toBe(false);
    // The advisor still hears about it, through the channel that can say
    // "unknown".
    expect(result.payload.warnings).toContain(
      `Merged duplicate account "401(k)" seen in 2 documents — balances differ ($100,000 vs unknown); please verify which is current.`,
    );
  });
});
