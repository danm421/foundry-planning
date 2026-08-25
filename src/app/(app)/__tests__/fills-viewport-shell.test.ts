import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The app column that a [data-fills-viewport] route (the solver, divorce) turns
// into a viewport-height surface. A definite height alone does not hold it
// there: an absolutely-positioned descendant is only clipped by an ancestor in
// its CONTAINING-BLOCK chain, and with nothing positioned above it that chain
// skips this column entirely and runs to the initial containing block. Such a
// box then sits at its unscrolled document position — Tailwind's `sr-only` is
// position:absolute, and a table caption ~900px down a scrolled pane lands
// ~900px down the DOCUMENT — which grows the document past 100dvh. The whole
// surface then scrolls: the topbar rides away, the footer lifts off the bottom
// of the screen leaving dead space, and neither pane shows any more content.
//
// `relative` makes the column that containing block and `overflow-clip` clips
// at the viewport edge. Measured in Chromium at 1413x850 by planting an
// absolute box 900px down inside <main>: 0px of document scroll with both
// classes, 450px with position:static + overflow:visible.
//
// clip, not hidden: `hidden` would make the column a scroll container, and a
// focus jump into clipped content could scroll the topbar away for good.
//
// Layouts are async server components that reach for Clerk and the DB, so this
// reads the source rather than rendering — it pins the CLASSES, and can only
// catch one being dropped, never re-measure the overflow.
describe("(app) layout — the viewport-filling surface is sealed at 100dvh", () => {
  const source = readFileSync(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");

  it.each([
    ["relative", "makes the column the containing block for stray absolutes"],
    ["h-dvh", "gives the flex chain a definite height to resolve against"],
    ["min-h-0", "keeps min-h-screen from out-voting that height"],
    ["overflow-clip", "clips what escapes instead of growing the document"],
  ])("keeps has-[[data-fills-viewport]]:lg:%s — it %s", (utility) => {
    expect(source).toContain(`has-[[data-fills-viewport]]:lg:${utility}`);
  });
});
