//
// Risk Tolerance Questionnaire, version 1. Fixed and versioned in TS so any
// historical score can name the instrument that produced it -- a score stored
// under rtq_version 1 stays interpretable after v2 ships.
//
// Q3 asks about goal PRIORITY, not time horizon, on purpose: horizon is already
// 30% of the capacity score, and asking it here would let one fact push both
// ceilings. Q1 and Q4 both probe drawdown behavior on purpose -- stated versus
// revealed, where Q4 is the honesty check on Q1.

export const RTQ_VERSION = 1;

export interface RtqOption {
  value: string;
  label: string;
  /** 0-100, or null to exclude the question and redistribute its weight. */
  score: number | null;
}

export interface RtqQuestion {
  id: string;
  prompt: string;
  /** Percentage points. The five weights sum to 100. */
  weight: number;
  options: RtqOption[];
}

export type RtqAnswers = Record<string, string>;

export const RTQ_V1: RtqQuestion[] = [
  {
    id: "loss_reaction",
    prompt: "Your investments lose 20% of their value over six months. What do you do?",
    weight: 30,
    options: [
      { value: "sell_all", label: "Sell everything and move to cash", score: 0 },
      { value: "sell_some", label: "Sell some to reduce the risk", score: 30 },
      { value: "hold", label: "Do nothing and wait for a recovery", score: 70 },
      { value: "buy_more", label: "Invest more while prices are lower", score: 100 },
    ],
  },
  {
    id: "outcome_range",
    prompt: "Over the next ten years, which range of yearly outcomes would you rather live with?",
    weight: 25,
    options: [
      { value: "narrow", label: "Best year +25%, worst year -5%", score: 0 },
      { value: "modest", label: "Best year +40%, worst year -15%", score: 35 },
      { value: "wide", label: "Best year +60%, worst year -25%", score: 70 },
      { value: "widest", label: "Best year +80%, worst year -40%", score: 100 },
    ],
  },
  {
    id: "goal_priority",
    prompt: "Which best describes your goal for this money?",
    weight: 20,
    options: [
      { value: "protect", label: "Protect what I have above all else", score: 0 },
      { value: "mostly_protect", label: "Mostly protect it, with modest growth", score: 35 },
      { value: "balanced", label: "Balance growth and protection", score: 70 },
      { value: "maximize", label: "Maximize long-term growth, even with large swings", score: 100 },
    ],
  },
  {
    id: "prior_behavior",
    prompt: "During past market declines (2008, 2020, 2022), what did you actually do?",
    weight: 15,
    options: [
      { value: "sold", label: "Sold investments or moved to cash", score: 0 },
      { value: "reduced", label: "Reduced how much I had invested", score: 30 },
      { value: "held", label: "Held everything", score: 70 },
      { value: "added", label: "Added more", score: 100 },
      { value: "not_invested", label: "I was not invested at the time", score: null },
    ],
  },
  {
    id: "experience",
    prompt: "How would you describe your investing experience?",
    weight: 10,
    options: [
      { value: "none", label: "Little or none", score: 0 },
      { value: "some", label: "Some, mostly through an employer retirement plan", score: 35 },
      { value: "comfortable", label: "Comfortable - I follow markets and my investments", score: 70 },
      { value: "extensive", label: "Extensive, including individual securities or alternatives", score: 100 },
    ],
  },
];

export function isCompleteRtq(answers: RtqAnswers): boolean {
  return RTQ_V1.every((q) => q.options.some((o) => o.value === answers[q.id]));
}

/**
 * Weighted mean over the questions that carry a score. Dividing by the weight
 * actually used -- rather than by a fixed 100 -- is what redistributes Q4's
 * weight when a client answers "was not invested", so a young client is not
 * penalized for lacking a crisis history.
 */
export function scoreRtq(answers: RtqAnswers): number {
  let weighted = 0;
  let weightUsed = 0;

  for (const q of RTQ_V1) {
    const chosen = q.options.find((o) => o.value === answers[q.id]);
    if (!chosen) {
      throw new Error(`RTQ: missing or unrecognized answer for "${q.id}"`);
    }
    if (chosen.score === null) continue;
    weighted += chosen.score * q.weight;
    weightUsed += q.weight;
  }

  if (weightUsed === 0) throw new Error("RTQ: no scorable answers");
  return Math.round(weighted / weightUsed);
}
