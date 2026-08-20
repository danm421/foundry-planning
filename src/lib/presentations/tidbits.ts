/**
 * Educational tidbits for the Your Early Years deck.
 *
 * SINGLE SOURCE OF TRUTH — edit copy here, not inside page components.
 *
 * These are general financial-education copy, NOT compliance-reviewed
 * disclosures. They are written for a 25-35 year old client reading a PDF
 * their advisor handed them: plain, warm, concrete, no jargon without a
 * gloss, no hype, and nothing that reads as a personalized recommendation,
 * a guarantee, or a specific-security suggestion.
 *
 * Keep each body under ~320 characters: it renders in a narrow sidebar
 * beside a chart, and a long one pushes the chart off the sheet. If a body
 * is too long, shorten the copy — do not raise the limit.
 */
import { renderTokens } from "@/lib/plan-text/tokens";

export type TidbitTopic =
  | "compounding"
  | "taxes"
  | "debt"
  | "behavior"
  | "accounts"
  | "risk";

export interface Tidbit {
  id: string;
  title: string;
  body: string;
  topic: TidbitTopic;
}

export const TIDBITS: readonly Tidbit[] = [
  // ── Compounding ──────────────────────────────────────────────────────
  {
    id: "compounding-runway",
    title: "Time is the ingredient you can't buy later",
    topic: "compounding",
    body: "{{client_first_name}}, a dollar saved in your twenties has decades to double and double again. The same dollar saved at fifty gets one or two doublings. Nothing else in this report is worth as much as starting early.",
  },
  {
    id: "compounding-small-amounts",
    title: "Small amounts become the majority of the story",
    topic: "compounding",
    body: "The plan currently shows {{portfolio_assets}} in liquid assets. An extra $50 a month feels small against that today. Given 30 years of growth, small, steady amounts end up doing most of the work — not one big deposit.",
  },
  {
    id: "compounding-rule-of-72",
    title: "A quick way to see compounding at work",
    topic: "compounding",
    body: "Divide 72 by an assumed growth rate to estimate how many years it takes money to double. As one hypothetical example, at a 7% assumed rate that's about a decade — twice over a 20-year stretch, if growth held steady.",
  },
  {
    id: "compounding-automate",
    title: "Automate it once, benefit from it every month",
    topic: "compounding",
    body: "A contribution set to happen automatically turns compounding from a decision you make every month into one you made once. The plan keeps growing in the background whether or not it's on your mind that week.",
  },
  {
    id: "compounding-cost-of-waiting",
    title: "Waiting five years costs more than five years",
    topic: "compounding",
    body: "Starting five years late doesn't just skip five years of deposits — it skips five of the years those dollars would have had to grow before age {{client_retirement_age}}. Early money works the longest, not just the hardest.",
  },

  // ── Taxes ────────────────────────────────────────────────────────────
  {
    id: "lowest-bracket-of-your-life",
    title: "Early-career tax rates are often the lowest you will see",
    topic: "taxes",
    body: "Roth contributions are taxed now and never again. Paying tax at today's rate, early in a career, is usually the cheapest tax you will ever pay.",
  },
  {
    id: "taxes-roth-vs-traditional",
    title: "Roth now, or traditional later — the timing matters",
    topic: "taxes",
    body: "A Roth account taxes the contribution today; a traditional account taxes the withdrawal decades from now. Whichever rate is lower — today's or retirement's — is the one worth paying, and early career is often the lower one.",
  },
  {
    id: "taxes-hsa-triple",
    title: "One account, three tax breaks",
    topic: "taxes",
    body: "A Health Savings Account is one of the few places money can go in tax-free, grow tax-free, and come out tax-free for qualified medical costs. If one is available to you, it's worth understanding before ruling it out.",
  },
  {
    id: "taxes-capital-gains-holding",
    title: "How long you hold an investment can change its tax bill",
    topic: "taxes",
    body: "Investments held longer than a year are generally taxed at lower long-term capital-gains rates than ones sold within a year of purchase. Holding period is one of the few tax levers an investor fully controls.",
  },
  {
    id: "taxes-withholding-refund",
    title: "A big refund is an interest-free loan you made",
    topic: "taxes",
    body: "A large tax refund means extra was withheld from every paycheck all year, with no interest paid on it. Adjusting withholding so less is overpaid puts that same cash in your hands sooner instead of the government's.",
  },

  // ── Debt ─────────────────────────────────────────────────────────────
  {
    id: "debt-good-vs-costly",
    title: "The interest rate matters more than the balance",
    topic: "debt",
    body: "A mortgage or student loan at a low fixed rate behaves very differently from a credit card compounding at 20%+. The rate — not the size of the number — is what should set which debt gets attention first.",
  },
  {
    id: "debt-emergency-fund-first",
    title: "A cash cushion protects the debt payoff, not just you",
    topic: "debt",
    body: "Paying down debt aggressively with zero savings can push the next surprise expense right back onto a card. A small emergency fund first keeps one bad month from turning into a new balance.",
  },
  {
    id: "debt-avalanche-snowball",
    title: "Two ways to order a payoff — both beat no plan",
    topic: "debt",
    body: "Highest interest rate first saves the most money over time. Smallest balance first builds momentum from quick wins. Either approach works better than no approach; the one you'll actually stick with is the right one.",
  },
  {
    id: "debt-minimums-are-a-floor",
    title: "A minimum payment is a floor, not a plan",
    topic: "debt",
    body: "A minimum payment covers the interest plus a small slice of the balance. Paying only the minimum stretches a debt across the longest schedule the terms allow, so more of what you pay goes to interest and less of it to the balance.",
  },
  {
    id: "debt-student-loan-terms",
    title: "Loan terms change — check before assuming",
    topic: "debt",
    body: "Federal student loan rules, including repayment plans and forgiveness programs, have shifted more than once in recent years. Checking your servicer's current terms beats assuming last year's rules still apply.",
  },

  // ── Behavior ─────────────────────────────────────────────────────────
  {
    id: "behavior-pay-yourself-first",
    title: "Save before you spend, not after",
    topic: "behavior",
    body: "Saving whatever's left at the end of the month usually means saving nothing — there's rarely anything left. Moving money out the day you're paid treats saving like a bill instead of an afterthought.",
  },
  {
    id: "behavior-lifestyle-creep",
    title: "Every raise is a small decision",
    topic: "behavior",
    body: "The plan shows {{annual_savings}} saved this year. Each raise is a choice: bank part of it, or let spending rise to match it. Directing even half of a raise toward savings lets both your lifestyle and your savings rate improve.",
  },
  {
    id: "behavior-avoid-market-timing",
    title: "Trying to time the market rarely pays off",
    topic: "behavior",
    body: "Buying at the bottom and selling at the top sounds appealing and is hard to do consistently, even for professionals. A steady, unglamorous contribution schedule tends to outperform trying to guess what markets do next.",
  },
  {
    id: "behavior-fees-compound-too",
    title: "Fees compound in reverse",
    topic: "behavior",
    body: "A 1% annual fee sounds small until it's charged every year against a growing balance for 30 years. Checking what an account actually costs is worth the ten minutes it takes — the effect adds up the same way growth does.",
  },
  {
    id: "behavior-review-annually",
    title: "Revisit the plan once a year, on purpose",
    topic: "behavior",
    body: "A plan for {{household_names}} built once and never opened again drifts from real life. A once-a-year check-in — after a raise, a move, a new job — keeps the plan pointed at where things actually stand now.",
  },

  // ── Accounts ─────────────────────────────────────────────────────────
  {
    id: "match-is-not-a-bonus",
    title: "An employer match isn't a bonus",
    topic: "accounts",
    body: "It's part of your pay that only arrives if you contribute enough to claim it. Turning it down is choosing a smaller salary.",
  },
  {
    id: "accounts-vesting-schedule",
    title: "Matched dollars aren't always yours yet",
    topic: "accounts",
    body: "Some employer matches vest over time — meaning you may need to stay a set number of years before the matched amount is fully yours to keep. Knowing your plan's vesting schedule avoids a surprise if you leave early.",
  },
  {
    id: "accounts-emergency-fund-separate",
    title: "A retirement account isn't an emergency fund",
    topic: "accounts",
    body: "Pulling money out of a retirement account early often triggers both tax and a penalty. Keeping a separate, easy-to-reach cushion protects the emergency and the long-term plan at the same time.",
  },
  {
    id: "accounts-brokerage-flexibility",
    title: "A taxable account trades tax perks for flexibility",
    topic: "accounts",
    body: "A regular brokerage account skips the tax advantages of a retirement account, but also skips its withdrawal restrictions. It's a reasonable place for savings you might need well before retirement age.",
  },
  {
    id: "accounts-beneficiaries",
    title: "The beneficiary form outranks the will",
    topic: "accounts",
    body: "Retirement and life insurance accounts pass directly to whoever is named as beneficiary on the account — a will does not override that. A name entered at 24 can still be the one in effect decades later if it's never updated.",
  },

  // ── Risk ─────────────────────────────────────────────────────────────
  {
    id: "risk-time-horizon",
    title: "Time horizon, not mood, should set the risk level",
    topic: "risk",
    body: "A 30-year horizon can absorb a market decline that a 3-year horizon can't recover from in time. How many years until the money is needed — not how a bad week feels — is what should drive how much risk to carry.",
  },
  {
    id: "risk-diversification",
    title: "One paycheck, one portfolio, one bet",
    topic: "risk",
    body: "Concentrating savings in a single stock — including your own employer's — ties your paycheck and your portfolio to the same outcome. Spreading investments across many companies and sectors reduces that overlap.",
  },
  {
    id: "risk-volatility-is-normal",
    title: "Ups and downs are normal, not a warning sign",
    topic: "risk",
    body: "A plan is modeled across many market paths — good years and bad ones both — before it reports a confidence figure. A market moving up or down in a given year isn't a sign the plan is off track.",
  },
  {
    id: "risk-insurance-as-a-backstop",
    title: "Insurance protects the plan, not the returns",
    topic: "risk",
    body: "Insurance isn't there to grow your money — it's there so one bad event doesn't erase years of saving. The right amount to carry depends on what's being protected, not on a single round number.",
  },
  {
    id: "risk-inflation-erodes-cash",
    title: "Cash sitting still is quietly losing ground",
    topic: "risk",
    body: "Money left in cash loses purchasing power every year prices rise. Holding some cash for near-term needs makes sense; holding all long-term savings in cash quietly shrinks what it can buy later.",
  },
] as const;

export function tidbitsById(ids: string[]): Tidbit[] {
  const byId = new Map(TIDBITS.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Tidbit => t != null);
}

/** Tidbits with their `{{token}}` placeholders resolved for this household. */
export function renderTidbits(
  ids: string[],
  tokenValues: Record<string, string | null>,
): Tidbit[] {
  return tidbitsById(ids).map((t) => ({ ...t, body: renderTokens(t.body, tokenValues) }));
}
