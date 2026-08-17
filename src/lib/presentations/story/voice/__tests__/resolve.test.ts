// The one place profile + rows become the two values the prompt takes. Both
// routes read it through `run-context.ts`, so anything non-deterministic or
// order-dependent here reports every chapter of every report out of date.
import { describe, it, expect } from "vitest";
import { EMPTY_VOICE, resolveVoice } from "../resolve";

// One object is the default at dozens of call sites, so a push into it would
// change every prompt and every stored hash at once. Both levels, because
// freezing the wrapper alone still leaves `samples` open.
describe("EMPTY_VOICE", () => {
  it("is frozen, and so is its sample list", () => {
    expect(Object.isFrozen(EMPTY_VOICE)).toBe(true);
    expect(Object.isFrozen(EMPTY_VOICE.samples)).toBe(true);
  });
});

describe("resolveVoice", () => {
  it("takes only the enabled samples", () => {
    const out = resolveVoice(null, [
      { text: "on", enabled: true } as never,
      { text: "off", enabled: false } as never,
    ]);
    expect(out.samples).toEqual(["on"]);
  });

  // Kills: dropping the blank-text half of the filter. A sample that is nothing
  // but whitespace is an empty quoted block in all fourteen system prompts —
  // and it changes the hash, so it is not merely untidy.
  it("drops a sample whose text is blank", () => {
    const out = resolveVoice(null, [
      { text: "   \n\t ", enabled: true } as never,
      { text: "real", enabled: true } as never,
    ]);
    expect(out.samples).toEqual(["real"]);
  });

  // …and it emits the string it judged, not the raw one. Kills: a filter that
  // trims and a `map` that does not — "\n\nreal\n\n" clears the blank check and
  // then reaches the prompt wrapped in empty quoted lines.
  // `prompts.ts#quoteAdvisorText` keeps those from being bare lines; it does not make
  // them worth sending.
  it("emits the trimmed text, the same string the filter judged", () => {
    const out = resolveVoice(null, [{ text: "\n\n  real  \n\n", enabled: true } as never]);
    expect(out.samples).toEqual(["real"]);
  });

  /**
   * A ceiling, because every sample is a system-prompt line on every one of
   * fourteen chapters. Newest first — `listVoiceSamples` orders that way — so an
   * advisor's most recent writing is what the model sees.
   */
  it("sends at most four samples", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `s${i}`, enabled: true }) as never);
    expect(resolveVoice(null, many).samples).toHaveLength(4);
  });

  // …and they are the FIRST four of the given order, not any four. The order is
  // `listVoiceSamples`' — newest first, pinned in `repo.test.ts` — so this is the
  // half of that contract that lives on this side of the call.
  it("keeps the first four in the order it was given", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `s${i}`, enabled: true }) as never);
    expect(resolveVoice(null, many).samples).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("carries the style note through", () => {
    expect(resolveVoice({ firmId: "f", advisorUserId: "u", styleNote: "short sentences" }, []))
      .toMatchObject({ styleNote: "short sentences" });
  });

  it("answers an empty voice when there is no profile and no sample", () => {
    expect(resolveVoice(null, [])).toEqual({ styleNote: "", samples: [] });
  });

  // ⭐ The determinism proof. `resolveVoice` feeds `chapterSourceHash`, and a
  // resolver whose output order depends on anything but its input reports every
  // chapter of every report permanently out of date.
  it("is deterministic for the same input", () => {
    const samples = [{ text: "a", enabled: true }, { text: "b", enabled: true }] as never[];
    expect(resolveVoice(null, samples)).toEqual(resolveVoice(null, samples));
  });
});
