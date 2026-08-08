import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Signal } from "../signals";
import type { InsightsBattery } from "../battery";

// The model is the only IO in this module. Mocking it here keeps the suite
// runnable without Azure credentials — `chatModel` throws `ai_not_configured`
// the moment the env vars are absent (src/domain/forge/llm.ts).
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/domain/forge/llm", () => ({
  chatModel: () => ({ withStructuredOutput: () => ({ invoke }) }),
}));

import { dropUncitedActions, generateInsights } from "../generate";

const sig = (id: string): Signal => ({
  id,
  domain: "plan",
  severity: "watch",
  title: "t",
  detail: "d",
  numbers: {},
  href: null,
  estimatedImpact: null,
});

const battery = (signals: Signal[]): InsightsBattery => ({
  clientName: "Cooper Household",
  kpis: {
    netWorth: 2_000_000,
    liquidPortfolio: 1_200_000,
    yearsToRetirement: 5,
    mcSuccessRate: 0.9,
    fundingScore: 1.2,
  },
  retirementPeople: [],
  risk: { currentPct: 78, requiredPct: 45, capacityPct: 60, capacityScore: 60, verdict: "over_risked" },
  signals,
  mcBands: null,
  grounding: { goalsText: "", notesText: "", allocation: [] },
});

beforeEach(() => {
  invoke.mockReset();
  // The guard warns on every drop; silence it so a passing run stays readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("dropUncitedActions", () => {
  it("keeps actions citing a real signal", () => {
    const kept = dropUncitedActions(
      [{ signalId: "plan.funding_shortfall", recommendation: "r", why: "w" }],
      [sig("plan.funding_shortfall")],
    );
    expect(kept).toHaveLength(1);
  });

  // The load-bearing control: a model that invents a recommendation has to
  // attach it to an id, and an invented id is not in the input set.
  it("drops an action citing a signal that was never supplied", () => {
    const kept = dropUncitedActions(
      [
        { signalId: "plan.funding_shortfall", recommendation: "r", why: "w" },
        { signalId: "tax.invented_by_the_model", recommendation: "r", why: "w" },
      ],
      [sig("plan.funding_shortfall")],
    );
    expect(kept.map((a) => a.signalId)).toEqual(["plan.funding_shortfall"]);
  });

  it("drops every action when no signals were supplied", () => {
    expect(dropUncitedActions([{ signalId: "x", recommendation: "r", why: "w" }], []))
      .toEqual([]);
  });

  // The survivors carry the MODEL's ranking, not the signal order. The fixture
  // is deliberately asymmetric — signals arrive [a, b] and the expected output
  // is [b, a] — so an implementation that rebuilt the list by walking `signals`
  // would fail here rather than pass by coincidence.
  it("preserves the model's ranking among the survivors", () => {
    const kept = dropUncitedActions(
      [
        { signalId: "b", recommendation: "r", why: "w" },
        { signalId: "gone", recommendation: "r", why: "w" },
        { signalId: "a", recommendation: "r", why: "w" },
      ],
      [sig("a"), sig("b")],
    );
    expect(kept.map((a) => a.signalId)).toEqual(["b", "a"]);
  });
});

describe("generateInsights", () => {
  // Pins the WIRING, not the guard: a `dropUncitedActions` that works perfectly
  // is worthless if the generator never calls it before returning.
  it("strips an invented action from what the model returned", async () => {
    invoke.mockResolvedValue({
      headline: "h",
      snapshot: "s",
      goals: "g",
      actions: [
        { signalId: "plan.funding_shortfall", recommendation: "r1", why: "w1" },
        { signalId: "tax.invented_by_the_model", recommendation: "r2", why: "w2" },
      ],
      talkingPoints: ["tp"],
    });

    const { sections, cached } = await generateInsights({
      clientId: "c1",
      battery: battery([sig("plan.funding_shortfall")]),
      force: true,
    });

    expect(sections.actions.map((a) => a.signalId)).toEqual(["plan.funding_shortfall"]);
    expect(sections.headline).toBe("h");
    expect(sections.talkingPoints).toEqual(["tp"]);
    expect(cached).toBe(false);
  });

  it("sends the signal ids to the model so it has something to cite", async () => {
    invoke.mockResolvedValue({
      headline: "h",
      snapshot: "s",
      goals: "g",
      actions: [],
      talkingPoints: [],
    });

    await generateInsights({
      clientId: "c1",
      battery: battery([sig("risk.tolerance_stale")]),
      force: true,
    });

    const [messages] = invoke.mock.calls[0] as [Array<{ content: string }>];
    expect(messages.map((m) => m.content).join("\n")).toContain("risk.tolerance_stale");
  });
});
