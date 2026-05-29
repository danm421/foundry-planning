import type { EstatePageOptions } from "./options-schema";

export function summarizeEstateOptions(options: EstatePageOptions): string {
  const when =
    options.asOf.kind === "year"
      ? String(options.asOf.year)
      : options.asOf.kind === "today"
        ? "Today"
        : "Each death";
  const detail = options.showHeirDetail ? "Full detail" : "Totals only";
  return `${when} · ${detail}`;
}
