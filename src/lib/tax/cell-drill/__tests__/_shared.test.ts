import { describe, it, expect } from "vitest";
import { resolveSourceLabel } from "../_shared";
import type { CellDrillContext } from "../types";

const ctx: CellDrillContext = {
  accountNames: { acc_1: "Joint Brokerage", acc_2: "401k", acc_3: "Deferred Annuity" },
  incomes: [
    { id: "inc_1", name: "Spouse Salary", type: "salary", annualAmount: 0, startYear: 0, endYear: 0, growthRate: 0, owner: "spouse" } as never,
  ],
  accounts: [],
};

describe("resolveSourceLabel", () => {
  it("resolves a plain income id to its name", () => {
    expect(resolveSourceLabel("inc_1", ctx)).toBe("Spouse Salary");
  });

  it("resolves an account:kind compound id to 'Account — Kind'", () => {
    expect(resolveSourceLabel("acc_1:oi", ctx)).toBe("Joint Brokerage — OI");
    expect(resolveSourceLabel("acc_1:qdiv", ctx)).toBe("Joint Brokerage — Qual Div");
    expect(resolveSourceLabel("acc_2:rmd", ctx)).toBe("401k — RMD");
    expect(resolveSourceLabel("acc_1:stcg", ctx)).toBe("Joint Brokerage — ST CG");
    expect(resolveSourceLabel("acc_1:ltcg", ctx)).toBe("Joint Brokerage — LTCG");
  });

  it("handles withdrawal:<acctId> drill keys", () => {
    expect(resolveSourceLabel("withdrawal:acc_2", ctx)).toBe("401k — Withdrawal");
  });

  it("resolves roth_conversion:<id> to '<name> — Roth Conversion' when names are provided", () => {
    expect(
      resolveSourceLabel("roth_conversion:cv_4", {
        ...ctx,
        rothConversionNames: { cv_4: "Fill 24% Bracket" },
      }),
    ).toBe("Fill 24% Bracket — Roth Conversion");
  });

  it("falls back to 'Roth Conversion' when no name map is provided", () => {
    expect(resolveSourceLabel("roth_conversion:cv_4", ctx)).toBe("Roth Conversion");
  });

  it("names the IRMAA tier that limited a conversion, reading it off the ROW", () => {
    // The reason is a per-YEAR outcome and `ctx` is built once for every year,
    // so it has to arrive with the row. Same ctx, two different years' rows →
    // two different labels; a ctx-based lookup could only ever produce one.
    const namedCtx = { ...ctx, rothConversionNames: { cv_4: "Ladder" } };
    expect(
      resolveSourceLabel("roth_conversion:cv_4", namedCtx, {
        type: "ordinary_income",
        amount: 0,
        irmaaCapTier: 2,
      }),
    ).toBe("Ladder — Roth Conversion (limited by IRMAA Tier 2)");
    expect(
      resolveSourceLabel("roth_conversion:cv_4", namedCtx, {
        type: "ordinary_income",
        amount: 90_000,
      }),
      "a year the cap did not bind keeps the plain label",
    ).toBe("Ladder — Roth Conversion");
  });

  it("says the cap was EXCEEDED rather than 'limited by' when it did not hold", () => {
    // A capped conversion sharing a year with another conversion that solves
    // against the same income is sized to the ceiling and STILL finishes above
    // it. "limited by IRMAA Tier 2" would report a cap the engine did not
    // deliver, which is the one thing this label must never do.
    expect(
      resolveSourceLabel("roth_conversion:cv_4", ctx, {
        type: "ordinary_income",
        amount: 120_000,
        irmaaCapTier: 2,
        irmaaCapExceeded: true,
      }),
    ).toBe("Roth Conversion (IRMAA Tier 2 cap exceeded)");
    // The flag is meaningless without a tier and must not invent one.
    expect(
      resolveSourceLabel("roth_conversion:cv_4", ctx, {
        type: "ordinary_income",
        amount: 120_000,
        irmaaCapExceeded: true,
      }),
    ).toBe("Roth Conversion");
  });

  it("labels tier 0 — the surcharge-free band — rather than treating it as absent", () => {
    // `0` is the most common cap an advisor sets and the one a truthiness test
    // would silently drop.
    expect(
      resolveSourceLabel("roth_conversion:cv_4", ctx, {
        type: "ordinary_income",
        amount: 0,
        irmaaCapTier: 0,
      }),
    ).toBe("Roth Conversion (limited by IRMAA Tier 0)");
  });

  it("handles annuity:<acctId> and its tax-free twin", () => {
    // Without a dedicated arm these fall through to the generic `split(":")`
    // path, which reads the PREFIX as the account id — so the drill-down prints
    // "annuity — <raw account uuid>" at the advisor.
    expect(resolveSourceLabel("annuity:acc_3", ctx)).toBe("Deferred Annuity — Annuity Income");
    expect(resolveSourceLabel("annuity_tax_free:acc_3", ctx)).toBe(
      "Deferred Annuity — Annuity Income (tax-free)",
    );
  });

  it("falls back to the raw account id for an annuity the context does not name", () => {
    expect(resolveSourceLabel("annuity:acc_unknown", ctx)).toBe(
      "acc_unknown — Annuity Income",
    );
  });

  it("handles sale:<txId>", () => {
    expect(resolveSourceLabel("sale:tx_9", ctx)).toBe("Asset sale (tx_9)");
  });

  it("labels the three education-funding drill keys instead of leaking a goal UUID", () => {
    const goalId = "3f1b0c2a-0000-4000-8000-000000000001";
    expect(resolveSourceLabel(`education_tax_free:${goalId}`, ctx)).toBe(
      "Education funding — non-taxable distribution",
    );
    expect(resolveSourceLabel(`education_capital:${goalId}`, ctx)).toBe(
      "Education funding — capital gain",
    );
    expect(resolveSourceLabel(`education:${goalId}`, ctx)).toBe(
      "Education funding — taxable distribution",
    );
  });

  it("resolves note:<noteId>:interest|ltcg to '<name> — interest|capital gain' when names are provided", () => {
    const noteCtx: CellDrillContext = {
      ...ctx,
      noteNames: { note_1: "Sale of XYZ stock" },
    };
    expect(resolveSourceLabel("note:note_1:interest", noteCtx)).toBe(
      "Sale of XYZ stock — interest",
    );
    expect(resolveSourceLabel("note:note_1:ltcg", noteCtx)).toBe(
      "Sale of XYZ stock — capital gain",
    );
  });

  it("falls back to 'Note — interest|capital gain' when the note id isn't in the name map", () => {
    expect(resolveSourceLabel("note:abc-uuid:interest", ctx)).toBe("Note — interest");
    expect(resolveSourceLabel("note:abc-uuid:ltcg", ctx)).toBe("Note — capital gain");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(resolveSourceLabel("mystery_thing", ctx)).toBe("mystery_thing");
  });

  it("resolves tax_adjustment:<uuid> to 'Tax Adjustment' instead of splitting the uuid as a compound kind", () => {
    // Without a dedicated arm this falls into the generic `split(":")` path,
    // which reads "tax_adjustment" as an account id and uppercases the UUID
    // half as a "kind" — printing "tax_adjustment — <UUID>" at the advisor.
    const uuid = "3f1b0c2a-0000-4000-8000-000000000099";
    expect(resolveSourceLabel(`tax_adjustment:${uuid}`, ctx)).toBe("Tax Adjustment");
  });

  it("resolves equity-vest:<planId> to '<ticker> RSU — vest'", () => {
    const eCtx: CellDrillContext = { ...ctx, equityPlanNames: { plan_tsla: "TSLA RSU" } };
    expect(resolveSourceLabel("equity-vest:plan_tsla", eCtx)).toBe("TSLA RSU — vest");
  });

  it("resolves equity-ltcg:<planId> to '<ticker> RSU — sale'", () => {
    const eCtx: CellDrillContext = { ...ctx, equityPlanNames: { plan_tsla: "TSLA RSU" } };
    expect(resolveSourceLabel("equity-ltcg:plan_tsla", eCtx)).toBe("TSLA RSU — sale");
  });

  it("resolves equity-stcg:<planId> to '<ticker> RSU — sale (ST)'", () => {
    const eCtx: CellDrillContext = { ...ctx, equityPlanNames: { plan_tsla: "TSLA RSU" } };
    expect(resolveSourceLabel("equity-stcg:plan_tsla", eCtx)).toBe("TSLA RSU — sale (ST)");
  });

  it("falls back to planId when equityPlanNames absent", () => {
    expect(resolveSourceLabel("equity-vest:plan_tsla", ctx)).toBe("plan_tsla — vest");
  });
});
