import { describe, it, expect } from "vitest";
import { resolveSourceLabel } from "../_shared";
import type { CellDrillContext } from "../types";

const ctx: CellDrillContext = {
  accountNames: { acc_1: "Joint Brokerage", acc_2: "401k" },
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

  it("handles sale:<txId>", () => {
    expect(resolveSourceLabel("sale:tx_9", ctx)).toBe("Asset sale (tx_9)");
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
