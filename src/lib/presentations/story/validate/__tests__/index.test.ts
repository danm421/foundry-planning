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

describe("runGates — the two register gates", () => {
  const facts = [moneyFact("outcome.legacy.base", "Left at the end, current plan", 9_200_000)];

  it("reports a leaked label", () => {
    const out = runGates("Left at the end, current plan: $9.2M.", facts, ["Cooper"]);
    expect(out.some((f) => f.gate === "labels")).toBe(true);
  });

  it("reports self-reference", () => {
    const out = runGates("This page shows what you own.", facts, ["Cooper"]);
    expect(out.some((f) => f.gate === "register")).toBe(true);
  });

  it("reports a name used in the third person", () => {
    const out = runGates("For Cooper, that means more room.", facts, ["Cooper"]);
    expect(out.some((f) => f.gate === "register")).toBe(true);
  });

  // Deliberately UNEVEN in rhythm: three sentences of near-identical length are
  // a Gate 4 rejection on their own, and a "clean prose" fixture that trips
  // another gate proves nothing about these two.
  it("passes clean second-person prose", () => {
    const out = runGates(
      "You end up with about $9.2M. That is more room than you started with, and it holds even if the market has a poor decade early on. Nothing needs fixing today.",
      facts,
      ["Cooper"],
    );
    expect(out).toEqual([]);
  });

  it("still runs the four original gates", () => {
    const out = runGates("You have $3.4M saved.", facts, ["Cooper"]);
    expect(out.some((f) => f.gate === "facts")).toBe(true);
  });
});
