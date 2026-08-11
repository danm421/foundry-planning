import { describe, it, expect } from "vitest";
import { runGates } from "../index";
import { moneyFact } from "../../facts";

const FACTS = [moneyFact("liquid", "Liquid assets", 2_100_000)]; // "$2.1M"

describe("runGates", () => {
  it("returns no failures for grounded, plain, varied prose", () => {
    const md =
      "You hold $2.1M today. That is enough to carry the plan through the years we modelled, and it leaves room to spare.";
    expect(runGates(md, FACTS)).toEqual([]);
  });

  it("collects failures from every gate at once", () => {
    const md = "It's important to note that your $9.9M in decumulation assets is fine.";
    const gates = runGates(md, FACTS).map((f) => f.gate);
    expect(gates).toContain("facts");
    expect(gates).toContain("readability");
    expect(gates).toContain("voice");
  });
});
