// "Things worth knowing" — the optional back page. Collects tidbits that had no
// natural home beside a chart.
//
// Deliberately NOT in the built-in template: the spec asks for it to be a page
// the advisor adds on purpose, because a wall of tidbits at the back reads as
// filler.

import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsTidbitsPageData,
  EarlyYearsTidbitsPageOptions,
} from "./types";

export function buildEarlyYearsTidbitsData(
  ctx: BuildDataContext,
  options: EarlyYearsTidbitsPageOptions,
): EarlyYearsTidbitsPageData {
  if (options.tidbits.length === 0) return { tidbits: [] };
  // The tokens describe the same plan the rest of the deck describes, so they
  // resolve against base — with the usual fallback to `ctx`, because
  // `bundlesByRef` is optional on `BuildDataContext` and a caller that skipped
  // ref loading would otherwise print the em-dash fallback for every figure.
  const base = ctx.bundlesByRef?.base;
  return {
    tidbits: renderTidbits(
      options.tidbits,
      resolveAllTokens({
        clientData: base?.clientData ?? ctx.clientData,
        projection: base?.projection ?? ctx.projection,
        monteCarlo: ctx.monteCarlo?.summary ?? null,
      }),
    ),
  };
}
