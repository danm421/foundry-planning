// Gate 7 — a person's name that is not in THIS household.
//
// The six shipped gates judge what prose says about the plan in front of them.
// None of them can see the failure an exemplar introduces. An exemplar is text
// harvested from one household and sent while writing another's, and a model
// asked to copy its rhythm can copy a NAME with it. Gate 1 catches a leaked
// FIGURE — it is not in this pack's spellings — and there is nothing for a
// leaked name.
//
// The exemplar path is BUILT AND NOT YET FED at this commit: `prompts.ts` injects
// `voiceSamples` and `run-context.ts` still hands it `[]`. This gate goes in
// first, deliberately — it is the check that has to exist before anything fills
// that list.
//
// ⚠️⚠️ This gate reads capitalised words, and a financial report is full of them:
// Social Security, Roth, Medicare, Traditional IRA, every month, every sentence
// opener. It is therefore an ALLOWLIST gate, not a detector — it fires only on a
// capitalised word that is in the given-names dictionary and is not one of this
// household's. A detector built the other way round (capitalised ⇒ suspicious)
// was rejected in design: it fires on ordinary prose, costs the chapter its one
// retry, and its fallback is weaker than what it rejected.
//
// There is deliberately NO sentence-position exemption. Excusing a dictionary
// name for opening a sentence would blind the gate to "Cooper, your plan holds
// up" — which is at once the canonical leak AND the exact shape `prompts.ts`
// shows the model as the one permitted use of a name, so it is where a copied
// name lands. The false-positive defence lives entirely in `given-names.ts`,
// which is curated to under-fire; read its header before adding an entry.
import { GIVEN_NAMES } from "./given-names";
import type { GateFailure, Validator } from "./types";

export function foreignNamesGate(firstNames: string[]): Validator {
  const ours = new Set(firstNames.map((n) => n.toLowerCase()));
  return (markdown: string): GateFailure[] => {
    // Deduplicated, and ONE failure for all of them: each message is reused
    // verbatim in the single retry prompt, and a name repeated four times is
    // still one thing to fix.
    const found = new Set<string>();
    // Capitalised, then lower case — "Cooper", "Susan". A word in caps ("IRA")
    // is an initialism, not a name, and never reaches the dictionary. Built per
    // call: a `g` regex carries its own cursor, and one shared across chapters
    // would start reading the next one from wherever the last one stopped.
    const word = /\p{Lu}\p{Ll}+/gu;
    for (let m = word.exec(markdown); m !== null; m = word.exec(markdown)) {
      const token = m[0];
      const lower = token.toLowerCase();
      if (ours.has(lower)) continue;
      if (!GIVEN_NAMES.has(lower)) continue;
      found.add(token);
    }
    if (found.size === 0) return [];
    return [
      {
        gate: "foreignName",
        message:
          `You named ${[...found].join(", ")}, who is not part of this household. ` +
          "Write only about the people this plan is for, and use no other person's name.",
      },
    ];
  };
}
