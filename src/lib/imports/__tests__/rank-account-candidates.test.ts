import { describe, expect, it } from "vitest";
import { rankAccountCandidates } from "../rank-account-candidates";

const acct = (id: string, name: string, category: string, value: number) => ({
  id,
  name,
  category,
  value,
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("rankAccountCandidates", () => {
  const existing = [
    acct("house", "Primary Residence", "real_estate", 500_000),
    acct("ira", "Fidelity IRA", "retirement", 480_000),
    acct("joint", "Joint Brokerage", "taxable", 100_000),
    acct("trust", "Trust Account", "taxable", 495_000),
    acct("biz", "Smith LLC", "business", 500_000),
  ];

  it("hides properties from an investment account's list", () => {
    const ranked = rankAccountCandidates(
      { name: "Schwab Brokerage", category: "taxable", value: 500_000 },
      existing,
    );
    expect(ids(ranked)).not.toContain("house");
  });

  it("still offers properties to an extracted property", () => {
    const ranked = rankAccountCandidates(
      { name: "Lake House", category: "real_estate", value: 400_000 },
      existing,
    );
    expect(ids(ranked)[0]).toBe("house");
  });

  it("keeps a property the row is already linked to, so the picker still shows it", () => {
    const ranked = rankAccountCandidates(
      { name: "Schwab Brokerage", category: "taxable", value: 500_000 },
      existing,
      "house",
    );
    expect(ids(ranked)).toContain("house");
  });

  it("lists the extracted account's own type first, then the rest", () => {
    const ranked = rankAccountCandidates(
      { name: "Schwab Brokerage", category: "taxable", value: 500_000 },
      existing,
    );
    expect(ids(ranked).slice(0, 2).sort()).toEqual(["joint", "trust"]);
  });

  it("puts the closest value first within a type", () => {
    const ranked = rankAccountCandidates(
      { name: "Schwab Account", category: "taxable", value: 500_000 },
      [
        acct("far", "Joint", "taxable", 100_000),
        acct("near", "Individual", "taxable", 490_000),
        acct("mid", "Trust", "taxable", 300_000),
      ],
    );
    expect(ids(ranked)).toEqual(["near", "mid", "far"]);
  });

  it("lets a matching name lift an account whose value has moved", () => {
    const ranked = rankAccountCandidates(
      { name: "Schwab Brokerage", category: "taxable", value: 500_000 },
      [
        acct("other", "Joint Account", "taxable", 470_000),
        acct("same-name", "Schwab Brokerage", "taxable", 400_000),
      ],
    );
    expect(ids(ranked)[0]).toBe("same-name");
  });

  it("ranks by name alone when the statement shows no value", () => {
    const ranked = rankAccountCandidates(
      { name: "Fidelity IRA", category: "retirement" },
      [
        acct("roth", "Vanguard Roth", "retirement", 50_000),
        acct("ira", "Fidelity IRA", "retirement", 900_000),
      ],
    );
    expect(ids(ranked)[0]).toBe("ira");
  });
});
