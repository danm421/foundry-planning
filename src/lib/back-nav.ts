/**
 * Pure "section trail" logic for the contextual back button.
 *
 * A *section* is a top-level area of the app. Navigating within a section
 * (e.g. a client's subtabs) collapses to a single trail entry that remembers
 * the latest sub-page; entering a different section pushes a new entry. The
 * back button targets the entry directly below the current one.
 *
 * Framework-free so it can be unit-tested in plain vitest.
 */

export interface TrailEntry {
  /** Stable id for the section, e.g. `client:abc`, `cma`, `clients`. */
  sectionKey: string;
  /** Exact pathname (+query) to return to. */
  href: string;
}

/** Friendly labels for top-level sections, mirroring the sidebar nav. */
export const STATIC_SECTION_LABELS: Record<string, string> = {
  cma: "CMA's",
  clients: "Clients",
  tasks: "Tasks",
  settings: "Settings",
};

const DEFAULT_MAX = 8;

/** Derive a section key from a pathname. */
export function sectionKeyForPath(pathname: string): string {
  const client = pathname.match(/^\/clients\/([^/]+)/);
  if (client) return `client:${client[1]}`;
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ?? "root";
}

/**
 * Add a location to the trail. Replaces the top entry when it shares the
 * current section (collapse), otherwise pushes — capping the trail length and
 * dropping the oldest entries past `max`.
 */
export function pushLocation(
  trail: TrailEntry[],
  entry: TrailEntry,
  max: number = DEFAULT_MAX,
): TrailEntry[] {
  const top = trail[trail.length - 1];
  if (top && top.sectionKey === entry.sectionKey) {
    return [...trail.slice(0, -1), entry];
  }
  const next = [...trail, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Remove the top (current) entry — used when navigating back. */
export function popTop(trail: TrailEntry[]): TrailEntry[] {
  return trail.slice(0, -1);
}

/** Resolve a display label for a section: registered → static → fallback. */
export function labelForSection(
  sectionKey: string,
  labels: Record<string, string>,
): string {
  if (labels[sectionKey]) return labels[sectionKey];
  if (STATIC_SECTION_LABELS[sectionKey]) return STATIC_SECTION_LABELS[sectionKey];
  if (sectionKey.startsWith("client:")) return "Client";
  return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1);
}
