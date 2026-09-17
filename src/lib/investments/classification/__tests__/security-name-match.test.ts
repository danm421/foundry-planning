import { describe, it, expect } from "vitest";
import {
  MAX_QUERY_ATTEMPTS,
  expandAbbreviations,
  relaxationLadder,
  scoreMatch,
  tokenize,
} from "../security-name-match";

describe("tokenize", () => {
  it("splits hyphens, because the index writes SMALL-CAP where a statement writes Small Cap", () => {
    expect(tokenize("Vanguard Small-Cap Value")).toEqual(["vanguard", "small", "cap", "value"]);
  });

  it("keeps & and digits — 'Dodge & Cox' and 'S&P 500' are names, not punctuation", () => {
    expect(tokenize("Dodge & Cox Income")).toEqual(["dodge", "&", "cox", "income"]);
    expect(tokenize("S&P 500 Index")).toEqual(["s&p", "500", "index"]);
  });
});

describe("expandAbbreviations", () => {
  it("spells out the share-class shorthand a statement uses", () => {
    expect(expandAbbreviations(["instl", "cl"])).toEqual(["institutional", "class"]);
  });

  it("expands a multi-word family abbreviation into its several words", () => {
    expect(expandAbbreviations(["trp", "equity"])).toEqual([
      "t", "rowe", "price", "equity",
    ]);
  });

  it("leaves an unknown word alone", () => {
    expect(expandAbbreviations(["galliard", "stable"])).toEqual(["galliard", "stable"]);
  });
});

describe("relaxationLadder", () => {
  it("tries the typed words FIRST, so an exact name is never second-guessed", () => {
    expect(relaxationLadder("Vanguard Small Cap Growth Index Fund Instl Class")[0]).toBe(
      "vanguard small cap growth index fund instl class",
    );
  });

  it("reaches the real fund by shedding the share-class tail", () => {
    const ladder = relaxationLadder("Vanguard Small Cap Growth Index Fund Instl Class");
    // Expanded, then stripped of packaging words ("fund", "class"), which is
    // the step that turns a zero-result query into the right family.
    expect(ladder).toContain("vanguard small cap growth index institutional");
    expect(ladder).toContain("vanguard small cap growth index");
  });

  it("fixes a LEADING abbreviation, which no amount of tail-dropping would reach", () => {
    expect(relaxationLadder("Trp Equity Income")).toContain("t rowe price equity income");
  });

  it("never widens below two words — one word answers with the whole fund family", () => {
    for (const attempt of relaxationLadder("American Beacon Large Cap Value Fund Class R6")) {
      expect(attempt.split(" ").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("caps the attempts, so one search can't become a dozen paid calls", () => {
    const ladder = relaxationLadder(
      "Vanguard Short Term Inflation Protected Securities Index Fund Admiral Shares",
    );
    expect(ladder.length).toBeLessThanOrEqual(MAX_QUERY_ATTEMPTS);
  });

  it("collapses to a single attempt when relaxing would change nothing", () => {
    // One plain word: expansion and packaging-stripping are both no-ops, and
    // the tail-drop loop can't run. Dedupe has to catch that or a one-word
    // query costs five identical calls.
    expect(relaxationLadder("vanguard")).toEqual(["vanguard"]);
  });
});

describe("scoreMatch", () => {
  const wanted = expandAbbreviations(
    tokenize("Vanguard Small Cap Growth Index Fund Instl Class"),
  );

  it("puts the share class the statement NAMED above the one it didn't", () => {
    const institutional = scoreMatch(
      { code: "VSGIX", name: "VANGUARD SMALL-CAP GROWTH INDEX FUND INSTITUTIONAL SHARES" },
      wanted,
    );
    const investor = scoreMatch(
      { code: "VISGX", name: "VANGUARD SMALL-CAP GROWTH INDEX FUND INVESTOR SHARES" },
      wanted,
    );
    expect(institutional).toBeGreaterThan(investor);
  });

  it("counts the CODE as a word, so searching a ticker rewards the row that IS it", () => {
    const ibm = expandAbbreviations(tokenize("IBM"));
    expect(scoreMatch({ code: "IBM", name: "International Business Machines" }, ibm))
      .toBeGreaterThan(
        scoreMatch({ code: "IBMQ", name: "International Business Machines" }, ibm),
      );
  });

  it("demotes a padded wrapper name over the fund it wraps", () => {
    const msci = expandAbbreviations(tokenize("BlackRock MSCI EAFE Index Fund"));
    const direct = scoreMatch({ code: "BKIE", name: "BlackRock MSCI EAFE Index Fund" }, msci);
    const wrapper = scoreMatch(
      { code: "GB00BGGRZK12", name: "Aviva Pension MyM BlackRock MSCI World Index Pn GTR in GB" },
      msci,
    );
    expect(direct).toBeGreaterThan(wrapper);
  });

  it("lets coverage outrank padding — one more matching word beats a dozen spare ones", () => {
    // The weighting that keeps padding a tie-break. A row matching one word
    // more must win even while carrying far more unrequested words, or a terse
    // wrong answer outranks a wordy right one.
    const q = expandAbbreviations(tokenize("Dodge Cox International Stock"));
    const rightButWordy = scoreMatch(
      { code: "DODFX", name: "Dodge & Cox International Stock Fund Class I Shares Of Beneficial Interest" },
      q,
    );
    const terseButWrong = scoreMatch({ code: "DODIX", name: "Dodge & Cox Income" }, q);
    expect(rightButWordy).toBeGreaterThan(terseButWrong);
  });

  it("separates two rows that both match everything, by what else they carry", () => {
    // The live regression this pins. "Vanguard Institutional Index Fund
    // Institutional Plus" — both of these contain every word asked for, so
    // coverage alone ties them and the winner falls to the feed's own order,
    // which put the European fund first. Only the padding term tells them apart.
    const wanted = expandAbbreviations(
      tokenize("Vanguard Institutional Index Fund Institutional Plus"),
    );
    const named = scoreMatch(
      { code: "VIIIX", name: "VANGUARD INSTITUTIONAL INDEX FUND INSTITUTIONAL PLUS SHARES" },
      wanted,
    );
    const otherAssetClass = scoreMatch(
      { code: "VEUPX", name: "VANGUARD EUROPEAN STOCK INDEX FUND INSTITUTIONAL PLUS SHARES" },
      wanted,
    );
    expect(named).toBeGreaterThan(otherAssetClass);
  });

  it("does not let a repeated query word count twice", () => {
    // "Institutional" appears twice above. Counted with duplicates, a row
    // holding it once scores as though it matched two words.
    const twice = expandAbbreviations(tokenize("Vanguard Institutional Index Institutional"));
    const once = expandAbbreviations(tokenize("Vanguard Institutional Index"));
    const row = { code: "VIIIX", name: "VANGUARD INSTITUTIONAL INDEX FUND" };
    expect(scoreMatch(row, twice)).toBe(scoreMatch(row, once));
  });

  it("scores an empty query at zero rather than dividing by nothing", () => {
    expect(scoreMatch({ code: "VTI", name: "Vanguard Total Stock Market ETF" }, [])).toBe(0);
  });
});
