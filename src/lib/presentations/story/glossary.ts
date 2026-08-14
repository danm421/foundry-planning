// The plain-language layer the spec names as an honest gap: "no glossary, no
// plain-language layer over MC / real-vs-nominal / tax treatment".
//
// Every term Gate 2 bans has an entry here, and the suite pins that. The two are
// one contract read from opposite ends: the gate refuses a term used without an
// explanation in the same sentence, and this is the explanation. A banned term
// with no entry would be a term the report can never use and never explain.
//
// It carries MORE than the ban list — "confidence" is not banned and is the word
// this report leans on hardest — because the ban list is written from what a
// model reaches for, not from what a client stumbles on. The contract runs one
// way only: every banned term must be here, and this may hold anything else the
// household would ask about.
//
// ⚠️ Every entry costs the chapter's sheet. `things-to-know.ts` prints all of
// them inside a 300-word budget it shares with the assumptions, so an entry
// added here has to be paid for there — that chapter's own suite is what
// notices.
export interface GlossaryTerm {
  /** The term as a reader meets it, lowercased. `chapters/things-to-know.ts`
   *  capitalises it for the line it starts. */
  term: string;
  /**
   * What completes "Term — …", so it opens lowercase and closes with a full
   * stop. One sentence, no other banned term inside it, and NO FIGURE.
   *
   * "No figure" is not a style note: the chapter prints these verbatim and Gate
   * 1 rejects any number that is not in the household's own fact pack, which a
   * fixed sentence can never be. "One hundredth of a percent" below is written
   * the long way round for exactly that reason — "one percent" is a figure to
   * `validate/facts.ts`, and "a percent" is not.
   */
  plain: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: "confidence",
    plain: "the share of the futures we tested where your money lasted.",
  },
  {
    term: "drawdown",
    plain: "money coming out of your savings to live on.",
  },
  {
    term: "decumulation",
    plain: "the years you live off what you saved instead of adding to it.",
  },
  {
    term: "tax-deferred",
    plain: "savings you haven't paid income tax on yet; tax comes when you draw it.",
  },
  {
    term: "sequence-of-returns",
    plain: "bad market years early in retirement hurt more than later ones.",
  },
  {
    term: "basis point",
    plain: "one hundredth of a percent, the unit fees are quoted in.",
  },
  {
    term: "stochastic",
    plain: "worked out by testing your plan against thousands of markets.",
  },
  {
    term: "asset-liability",
    plain: "matching what you own against what you owe, over time.",
  },
  {
    term: "efficient frontier",
    plain: "the investment mix that has historically paid most for the risk taken.",
  },
  {
    term: "tax alpha",
    plain: "the extra you keep by watching how and when tax falls.",
  },
  {
    term: "glidepath",
    plain: "the way your mix moves toward safer holdings as you age.",
  },
];
