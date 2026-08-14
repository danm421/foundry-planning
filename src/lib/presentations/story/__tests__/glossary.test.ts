import { describe, it, expect } from "vitest";
import { GLOSSARY } from "../glossary";
import { BANNED_JARGON } from "../validate/readability";
import { runGates } from "../validate";

describe("the glossary", () => {
  it("explains every term Gate 2 bans", () => {
    // The gate's ban list and the glossary are the same problem from two sides:
    // the gate refuses an un-glossed term, and this is where it gets glossed.
    // A banned term with no entry is a term the report can never explain.
    const explained = new Set(GLOSSARY.map((t) => t.term.toLowerCase()));
    for (const term of BANNED_JARGON) {
      expect(explained.has(term.toLowerCase()), term).toBe(true);
    }
  });

  it("explains each term without using another banned term", () => {
    for (const entry of GLOSSARY) {
      for (const banned of BANNED_JARGON) {
        if (banned.toLowerCase() === entry.term.toLowerCase()) continue;
        expect(entry.plain.toLowerCase(), entry.term).not.toContain(banned.toLowerCase());
      }
    }
  });

  it("keeps every explanation to one short sentence", () => {
    for (const entry of GLOSSARY) {
      expect(entry.plain.split(/\s+/u).filter(Boolean).length, entry.term).toBeLessThanOrEqual(28);
      expect(entry.plain.split(/[.!?]\s/u).filter(Boolean), entry.term).toHaveLength(1);
    }
  });

  it("clears the gates, so the report cannot publish prose it would refuse", () => {
    for (const entry of GLOSSARY) {
      const failures = runGates(entry.plain, []);
      // The label and register gates are the ones that matter here; a glossary
      // entry is deliberately not varied in rhythm, so voice's rhythm rule is
      // exempted by the single-sentence input (it needs three units to fire).
      expect(
        failures.filter((f) => f.gate !== "voice"),
        entry.term,
      ).toEqual([]);
    }
  });

  /**
   * THE RED for the entry above it. Every `plain` is written to be publishable
   * on its own, so a suite that only ever asserts green cannot tell a working
   * gate runner from one wired to an empty list — the failure mode this pinned
   * rejection exists to make visible.
   */
  it("would refuse an explanation written in the register the gates ban", () => {
    const failures = runGates(
      "It's important to note that the report shows you should sell your Apple shares.",
      [],
    );
    expect(failures.map((f) => f.gate).sort()).toEqual(["advice", "register", "voice"]);
  });

  it("names no term twice", () => {
    const terms = GLOSSARY.map((t) => t.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });
});
