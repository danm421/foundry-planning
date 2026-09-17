// src/lib/investments/classification/security-name-match.ts
//
// Bridging the gap between how a STATEMENT names a fund and how the security
// index names it. Pure text, no IO — `search-securities.ts` owns the calls.
//
// EODHD's `/search` is a token-AND with exact whole-word matching: every word
// in the query must appear in the row, order doesn't matter, and nothing is
// fuzzy. "Smal" does not find "SMALL"; "Instl" does not find "INSTITUTIONAL".
// Measured against the 23 untickered holding names actually in the book, only
// 6 returned a single row — a statement's share-class tail ("Instl Class",
// "Cl I", "Class R6") is enough on its own to reduce a good query to nothing.
//
// So two things happen here:
//   1. RELAX — expand the shorthand a statement uses, then, only if the query
//      still finds nothing, drop words off the end until it does.
//   2. RE-RANK — score whatever comes back against the FULL name as typed, so
//      relaxing the query never costs precision. Dropping "Instl" is what makes
//      "Vanguard Small Cap Growth Index Fund Instl Class" return rows at all;
//      scoring against the original is what then puts the INSTITUTIONAL share
//      class on top of them instead of the Investor one.

/**
 * Statement shorthand → the word the index actually spells out.
 *
 * Deliberately short, and every entry is one a real statement in the book uses.
 * The risk of a bigger map is silent mis-expansion — a wrong entry doesn't error,
 * it just quietly searches for the wrong fund — so this grows only when a real
 * name needs it.
 */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  instl: "institutional",
  inst: "institutional",
  insti: "institutional",
  cl: "class",
  cls: "class",
  shs: "shares",
  adm: "admiral",
  adv: "advisor",
  inv: "investor",
  trp: "t rowe price",
  dfa: "dimensional",
  intl: "international",
  natl: "national",
  amer: "american",
  mkt: "market",
  mkts: "markets",
  sec: "securities",
  secs: "securities",
  idx: "index",
  grth: "growth",
  apprec: "appreciation",
  govt: "government",
  muni: "municipal",
  shortterm: "short term",
  longterm: "long term",
  interm: "intermediate",
  prot: "protected",
  alloc: "allocation",
};

/**
 * Packaging words — true of half the index, so they narrow a search without
 * identifying anything. Dropped one step BEFORE real words are, because losing
 * "Class" costs nothing and losing "Growth" changes the fund.
 */
const PACKAGING = new Set([
  "class", "shares", "share", "fund", "funds", "portfolio", "trust",
  "series", "cit", "the", "of", "and",
]);

/** Lower-case word list. Hyphens split — the index writes "SMALL-CAP" where a
 *  statement writes "Small Cap", and EODHD treats the two the same. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Words with statement shorthand spelled out. */
export function expandAbbreviations(words: string[]): string[] {
  return words.flatMap((w) => (ABBREVIATIONS[w] ? ABBREVIATIONS[w].split(" ") : [w]));
}

/** How many queries one search may cost. Each step past the first only runs
 *  when the one before it found NOTHING, so a query that already works still
 *  costs exactly one call — the ladder is paid for by searches that currently
 *  return an empty list. */
export const MAX_QUERY_ATTEMPTS = 5;

/**
 * The queries to try, in order, stopping at the first that returns anything.
 *
 * Verbatim first so an exact name or a ticker is never second-guessed, then
 * progressively less specific. Trailing words go first because that is where a
 * statement puts its share-class noise; a leading oddity ("Trp") is the
 * abbreviation map's job, since no amount of tail-dropping reaches it.
 */
export function relaxationLadder(query: string): string[] {
  const verbatim = tokenize(query);
  const expanded = expandAbbreviations(verbatim);
  const core = expanded.filter((w) => !PACKAGING.has(w));

  const out: string[] = [];
  const add = (words: string[]) => {
    const q = words.join(" ");
    if (q.length >= 2 && !out.includes(q)) out.push(q);
  };

  add(verbatim);
  add(expanded);
  add(core);
  // Shed one trailing word at a time. Never below two, which is too little to
  // identify a fund and would answer with the whole family.
  for (let n = core.length - 1; n >= 2; n--) add(core.slice(0, n));

  return out.slice(0, MAX_QUERY_ATTEMPTS);
}

/** What one unrequested word costs. Small on purpose: padding is a TIE-BREAK,
 *  not a rival to coverage. At 0.01 a row would need a dozen spurious words to
 *  lose to one that actually matches a word more, so "Shares" and "Corporation"
 *  never cost a row its place — but between two rows that match everything
 *  asked for, the one not also describing a different asset class wins.
 *
 *  A flat grace was tried first and is what a threshold gets wrong here:
 *  forgiving the first three extra words left "Vanguard Institutional Index
 *  Fund Institutional Plus" tied with the European Stock fund, and the tie fell
 *  to whichever the feed happened to list first. */
const PADDING_PER_WORD = 0.01;

/**
 * How well a row answers the name as ORIGINALLY typed, from ~0 to ~1.
 *
 * Both sides are expanded before comparing, so the row's "INSTITUTIONAL" and
 * the statement's "Instl" count as the match they are.
 */
export function scoreMatch(
  row: { code: string; name: string },
  wantedWords: string[],
): number {
  if (wantedWords.length === 0) return 0;

  const rowWords = expandAbbreviations(tokenize(row.name));
  // The code counts as a word: searching "IBM" should reward the row whose
  // symbol IS IBM, not only the ones that spell it out in the name.
  const rowSet = new Set([...rowWords, ...tokenize(row.code)]);

  // Distinct words only. A name that says "Institutional" twice is not asking
  // for it twice, and counting the repeat scores every row carrying the word
  // once as though it had matched two.
  const wanted = new Set(wantedWords);
  let matched = 0;
  for (const word of wanted) if (rowSet.has(word)) matched++;
  const coverage = matched / wanted.size;

  // Padding is counted from the ROW's side: words it carries that were never
  // asked for. That is what separates the fund named from a same-share-class
  // fund in another asset class, which matches every word asked for and then
  // some.
  const unrequested = rowWords.filter((w) => !wanted.has(w)).length;

  return coverage - unrequested * PADDING_PER_WORD;
}
