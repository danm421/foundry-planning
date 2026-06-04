// src/lib/presentations/pages/blank/summarize-options.ts
import type { BlankPageOptions } from "./options-schema";

export function summarizeBlankOptions(opts: BlankPageOptions): string {
  const firstLine = opts.markdown
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/[*_`>-]/g, "").trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Empty page";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}
