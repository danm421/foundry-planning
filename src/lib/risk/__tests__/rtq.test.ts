import { describe, it, expect } from "vitest";
import { RTQ_V1, RTQ_VERSION, scoreRtq, isCompleteRtq, type RtqAnswers } from "../rtq";

const pick = (fn: (opts: { score: number | null }[]) => number): RtqAnswers =>
  Object.fromEntries(RTQ_V1.map((q) => [q.id, q.options[fn(q.options)].value]));

const ALL_MAX = pick((o) => o.findIndex((x) => x.score === 100));
const ALL_MIN = pick((o) => o.findIndex((x) => x.score === 0));

describe("RTQ_V1 shape", () => {
  it("is version 1 with five questions whose weights sum to 100", () => {
    expect(RTQ_VERSION).toBe(1);
    expect(RTQ_V1).toHaveLength(5);
    expect(RTQ_V1.reduce((s, q) => s + q.weight, 0)).toBe(100);
  });

  it("gives every question unique option values and at least one 0 and one 100", () => {
    for (const q of RTQ_V1) {
      const values = q.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(q.options.some((o) => o.score === 0)).toBe(true);
      expect(q.options.some((o) => o.score === 100)).toBe(true);
    }
  });
});

describe("scoreRtq", () => {
  it("scores an all-maximum answer set at 100 and all-minimum at 0", () => {
    expect(scoreRtq(ALL_MAX)).toBe(100);
    expect(scoreRtq(ALL_MIN)).toBe(0);
  });

  it("weights the loss-reaction question most heavily", () => {
    const q1 = RTQ_V1[0];
    expect(q1.id).toBe("loss_reaction");
    expect(q1.weight).toBe(30);
    // Downgrading only Q1 from 100 to 0 costs 30 points.
    expect(scoreRtq({ ...ALL_MAX, loss_reaction: "sell_all" })).toBe(70);
  });

  it("redistributes Q4's weight when the client was not invested", () => {
    // Q4 excluded: remaining weights 30+25+20+10 = 85. Max answers on all of
    // them is still a perfect 100, not 85.
    expect(scoreRtq({ ...ALL_MAX, prior_behavior: "not_invested" })).toBe(100);
    // With Q1 at 0 and Q4 excluded: (0*30 + 100*25 + 100*20 + 100*10) / 85 = 65
    expect(
      scoreRtq({ ...ALL_MAX, loss_reaction: "sell_all", prior_behavior: "not_invested" }),
    ).toBe(65);
  });

  it("throws on a missing or unrecognized answer", () => {
    const { loss_reaction: _omitted, ...missing } = ALL_MAX;
    expect(() => scoreRtq(missing)).toThrow(/loss_reaction/);
    expect(() => scoreRtq({ ...ALL_MAX, loss_reaction: "bogus" })).toThrow(/loss_reaction/);
  });
});

describe("isCompleteRtq", () => {
  it("accepts a full answer set and rejects a partial one", () => {
    expect(isCompleteRtq(ALL_MAX)).toBe(true);
    const { experience: _omitted, ...partial } = ALL_MAX;
    expect(isCompleteRtq(partial)).toBe(false);
  });
});
