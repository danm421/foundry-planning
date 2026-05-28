import {
  PRESENTATION_PAGES,
  CATEGORY_ORDER,
  type PresentationPageId,
} from "@/components/presentations/registry";

export interface ReportRow {
  id: PresentationPageId;
  title: string;
  description: string;
  /** How many copies are already in the deck. */
  count: number;
}

export interface ReportSection {
  /** Category label, or "Recently added" for the recents section. */
  heading: string;
  rows: ReportRow[];
}

export interface SearchResult {
  sections: ReportSection[];
  /** Flat list of row ids in render order — for keyboard navigation. */
  order: PresentationPageId[];
}

const ALL_IDS = Object.keys(PRESENTATION_PAGES) as PresentationPageId[];

function toRow(id: PresentationPageId, counts: Record<string, number>): ReportRow {
  const page = PRESENTATION_PAGES[id];
  return {
    id,
    title: page.title,
    description: page.description,
    count: counts[id] ?? 0,
  };
}

/** Lower rank = better match; null = no match. */
function matchRank(id: PresentationPageId, q: string): number | null {
  const page = PRESENTATION_PAGES[id];
  const title = page.title.toLowerCase();
  const haystack = `${page.title} ${page.description} ${page.category}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => haystack.includes(t))) return null;
  // Gating is per-token; title ranking uses the full phrase. A multi-word query
  // only earns rank 0/1 when the title contains it contiguously — otherwise it
  // survives the token gate at rank 2. Fine for the current catalog; revisit if
  // multi-word title ranking ever matters.
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  return 2;
}

function withOrder(sections: ReportSection[]): SearchResult {
  return {
    sections,
    order: sections.flatMap((s) => s.rows.map((r) => r.id)),
  };
}

export function searchReports(
  query: string,
  counts: Record<string, number>,
  recents: PresentationPageId[],
): SearchResult {
  const q = query.trim().toLowerCase();

  if (q === "") {
    const sections: ReportSection[] = [];

    const recentRows = recents
      .filter((id) => id in PRESENTATION_PAGES)
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .map((id) => toRow(id, counts));
    if (recentRows.length > 0) {
      sections.push({ heading: "Recently added", rows: recentRows });
    }

    for (const category of CATEGORY_ORDER) {
      const rows = ALL_IDS.filter((id) => PRESENTATION_PAGES[id].category === category)
        .sort((a, b) => PRESENTATION_PAGES[a].title.localeCompare(PRESENTATION_PAGES[b].title))
        .map((id) => toRow(id, counts));
      if (rows.length > 0) sections.push({ heading: category, rows });
    }

    return withOrder(sections);
  }

  const ranked = ALL_IDS
    .map((id) => ({ id, rank: matchRank(id, q) }))
    .filter((x): x is { id: PresentationPageId; rank: number } => x.rank !== null);

  const sections: ReportSection[] = [];
  for (const category of CATEGORY_ORDER) {
    const rows = ranked
      .filter((x) => PRESENTATION_PAGES[x.id].category === category)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          PRESENTATION_PAGES[a.id].title.localeCompare(PRESENTATION_PAGES[b.id].title),
      )
      .map((x) => toRow(x.id, counts));
    if (rows.length > 0) sections.push({ heading: category, rows });
  }

  return withOrder(sections);
}
