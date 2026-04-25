import type { TimelineEvent } from "@/lib/timeline/timeline-types";

export type LifeEventKind =
  | "retirement"
  | "social_security"
  | "rmd"
  | "life_expectancy";

export type OverviewLifeEvent = {
  year: number;
  label: string;
  kind: LifeEventKind;
};

const ID_TO_KIND: Record<string, LifeEventKind> = {
  retire: "retirement",
  ss_claim: "social_security",
  death: "life_expectancy",
  rmd: "rmd",
};

function idPrefix(id: string): string | null {
  // id shape: "life:<suffix>:<subject>" or "rmd:<accountId>:<year>"
  const parts = id.split(":");
  if (parts[0] === "life" && parts.length >= 3) return parts[1];
  if (parts[0] === "rmd") return "rmd";
  return null;
}

export function deriveLifeEvents(events: TimelineEvent[]): OverviewLifeEvent[] {
  const mapped: OverviewLifeEvent[] = [];
  for (const e of events) {
    const prefix = idPrefix(e.id);
    if (!prefix) continue;
    const kind = ID_TO_KIND[prefix];
    if (!kind) continue;
    mapped.push({ year: e.year, label: e.title, kind });
  }

  mapped.sort((a, b) => a.year - b.year);

  // Dedup same-year same-kind (keeps first encountered; caller-side sort preserves primary over spouse
  // because detectors emit primary before spouse).
  const seen = new Set<string>();
  const deduped: OverviewLifeEvent[] = [];
  for (const e of mapped) {
    const key = `${e.year}:${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}
