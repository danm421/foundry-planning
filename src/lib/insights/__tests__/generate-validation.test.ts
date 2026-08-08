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
import { GeneratedInsightsSchema } from "../schemas";

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
  toleranceScore: 55,
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

  // Citing a REAL id over and over is the way around the citation check: every
  // copy passes it. Keep the FIRST — that is the model's own top-ranked framing
  // of the signal, and dropping to the last would silently re-order the list.
  it("keeps only the first action citing a given signal", () => {
    const kept = dropUncitedActions(
      [
        { signalId: "a", recommendation: "first", why: "w" },
        { signalId: "b", recommendation: "r", why: "w" },
        { signalId: "a", recommendation: "second", why: "w" },
      ],
      [sig("a"), sig("b")],
    );
    expect(kept.map((x) => x.signalId)).toEqual(["a", "b"]);
    expect(kept[0].recommendation).toBe("first");
  });

  // Literal 5 and literal ids on purpose: asserting against MAX_ACTIONS would
  // track the constant under test and stay green if someone changed it.
  it("caps the list at five, keeping the model's top five", () => {
    const ids = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const kept = dropUncitedActions(
      ids.map((id) => ({ signalId: id, recommendation: "r", why: "w" })),
      ids.map(sig),
    );
    expect(kept.map((a) => a.signalId)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  // The cap counts SURVIVORS, not input rows — otherwise a model that pads the
  // head of its list with junk ids starves the real actions out of the slots.
  it("counts only survivors against the cap", () => {
    const kept = dropUncitedActions(
      [
        ...["j0", "j1", "j2", "j3"].map((id) => ({ signalId: id, recommendation: "r", why: "w" })),
        ...["s0", "s1", "s2", "s3", "s4"].map((id) => ({ signalId: id, recommendation: "r", why: "w" })),
      ],
      ["s0", "s1", "s2", "s3", "s4"].map(sig),
    );
    expect(kept.map((a) => a.signalId)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });
});

describe("GeneratedInsightsSchema", () => {
  const valid = {
    headline: "Single-name concentration is the biggest risk today.",
    snapshot: "A pre-retiree couple five years from retirement.",
    goals: "- Retire at 65",
    actions: [
      { signalId: "portfolio.concentration", recommendation: "Trim the position", why: "42% of liquid assets" },
    ],
    talkingPoints: ["You are more exposed to one stock than you may realise."],
  };

  it("accepts a realistic profile", () => {
    expect(GeneratedInsightsSchema.safeParse(valid).success).toBe(true);
  });

  const tooLong = (n: number) => "x".repeat(n);

  it("rejects an over-long headline", () => {
    expect(GeneratedInsightsSchema.safeParse({ ...valid, headline: tooLong(301) }).success).toBe(false);
  });

  it("rejects an over-long snapshot", () => {
    expect(GeneratedInsightsSchema.safeParse({ ...valid, snapshot: tooLong(2_001) }).success).toBe(false);
  });

  it("rejects an over-long goals block", () => {
    expect(GeneratedInsightsSchema.safeParse({ ...valid, goals: tooLong(2_001) }).success).toBe(false);
  });

  it("rejects an over-long signalId", () => {
    const actions = [{ signalId: tooLong(121), recommendation: "r", why: "w" }];
    expect(GeneratedInsightsSchema.safeParse({ ...valid, actions }).success).toBe(false);
  });

  it("rejects an over-long recommendation", () => {
    const actions = [{ signalId: "a", recommendation: tooLong(501), why: "w" }];
    expect(GeneratedInsightsSchema.safeParse({ ...valid, actions }).success).toBe(false);
  });

  it("rejects an over-long why", () => {
    const actions = [{ signalId: "a", recommendation: "r", why: tooLong(501) }];
    expect(GeneratedInsightsSchema.safeParse({ ...valid, actions }).success).toBe(false);
  });

  it("rejects more than twelve actions", () => {
    const actions = Array.from({ length: 13 }, (_, i) => ({
      signalId: `s${i}`, recommendation: "r", why: "w",
    }));
    expect(GeneratedInsightsSchema.safeParse({ ...valid, actions }).success).toBe(false);
  });

  it("rejects an over-long talking point", () => {
    expect(
      GeneratedInsightsSchema.safeParse({ ...valid, talkingPoints: [tooLong(501)] }).success,
    ).toBe(false);
  });

  it("rejects more than twelve talking points", () => {
    const talkingPoints = Array.from({ length: 13 }, (_, i) => `tp${i}`);
    expect(GeneratedInsightsSchema.safeParse({ ...valid, talkingPoints }).success).toBe(false);
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
