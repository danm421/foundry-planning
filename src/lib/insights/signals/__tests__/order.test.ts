import { describe, it, expect } from "vitest";
import { orderSignals } from "../order";
import type { Signal } from "../types";

const sig = (over: Partial<Signal>): Signal => ({
  id: "plan.x", domain: "plan", severity: "watch", title: "t", detail: "d",
  numbers: {}, href: null, estimatedImpact: null, ...over,
});

describe("orderSignals", () => {
  it("sorts by severity rank before impact", () => {
    const out = orderSignals([
      sig({ id: "a", severity: "info", estimatedImpact: 999_999 }),
      sig({ id: "b", severity: "critical", estimatedImpact: 1 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("sorts by estimatedImpact descending within a severity", () => {
    const out = orderSignals([
      sig({ id: "a", severity: "opportunity", estimatedImpact: 100 }),
      sig({ id: "b", severity: "opportunity", estimatedImpact: 5000 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("sorts a null impact last within its severity", () => {
    const out = orderSignals([
      sig({ id: "a", severity: "watch", estimatedImpact: null }),
      sig({ id: "b", severity: "watch", estimatedImpact: 1 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
  });

  // Load-bearing: the ordered list is hashed for staleness. Two signals with
  // equal severity AND equal impact must not swap between runs.
  it("breaks an exact tie on id, deterministically", () => {
    const a = sig({ id: "risk.aaa", severity: "watch", estimatedImpact: 10 });
    const b = sig({ id: "risk.bbb", severity: "watch", estimatedImpact: 10 });
    expect(orderSignals([b, a]).map((s) => s.id)).toEqual(["risk.aaa", "risk.bbb"]);
    expect(orderSignals([a, b]).map((s) => s.id)).toEqual(["risk.aaa", "risk.bbb"]);
  });

  it("does not mutate its input", () => {
    const input = [sig({ id: "b", severity: "info" }), sig({ id: "a", severity: "critical" })];
    orderSignals(input);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
