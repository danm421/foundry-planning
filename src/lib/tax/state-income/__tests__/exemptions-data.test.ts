// src/lib/tax/state-income/__tests__/exemptions-data.test.ts
//
// Guard for the EXEMPTIONS table: every dollar amount the engine reads must
// carry a kind ("exemption" = deduction from income, "credit" = off the tax
// bill). A component whose kind is "none" contributes nothing, so a nonzero
// amount filed under "none" is money silently thrown away — exactly how ME's
// $5,300 personal exemption and KY's $40 65+ credit went missing.
//
// This is also the tripwire for a regeneration of the (auto-generated) data
// file that drops the hand-added `add65Type` column.
//
// `dependent` is deliberately NOT covered: the engine never reads it. Give it
// its own kind when it is wired up, and extend this guard then.
import { describe, it, expect } from "vitest";
import { EXEMPTIONS } from "../data/exemptions";

const rows = Object.entries(EXEMPTIONS).flatMap(([year, byState]) =>
  Object.entries(byState).map(([state, row]) => ({ where: `${year} ${state}`, row })),
);

describe("EXEMPTIONS data — no amount sits under a 'none' kind", () => {
  it("covers every row in the table", () => {
    expect(rows.length).toBeGreaterThan(40);
  });

  it("a 'none' personal kind means $0 single and $0 joint", () => {
    const offenders = rows
      .filter(({ row }) => row.type === "none" && (row.single !== 0 || row.joint !== 0))
      .map(({ where, row }) => `${where}: single=${row.single} joint=${row.joint}`);
    expect(offenders).toEqual([]);
  });

  it("a 'none' 65+ kind means a $0 65+ add-on", () => {
    const offenders = rows
      .filter(({ row }) => (row.add65Type ?? row.type) === "none" && row.add65 !== 0)
      .map(({ where, row }) => `${where}: add65=${row.add65}`);
    expect(offenders).toEqual([]);
  });
});
