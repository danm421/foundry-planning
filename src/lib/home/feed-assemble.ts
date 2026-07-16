import { COMING_UP_KINDS, type FeedItem, type HomeFeed } from "./types";

export const GROUP_CAP = 15;

/**
 * Pure merge/sort/cap of feed items into the two display groups.
 * Coming-up sorts soonest-first (overdue tasks have past `when`, so they
 * naturally lead); recent sorts newest-first. Ties break by id so the
 * output is stable across renders.
 */
export function assembleFeed(items: FeedItem[]): HomeFeed {
  const comingUp = items
    .filter((i) => COMING_UP_KINDS.has(i.kind))
    .sort(
      (a, b) => a.when.getTime() - b.when.getTime() || a.id.localeCompare(b.id),
    )
    .slice(0, GROUP_CAP);
  const recent = items
    .filter((i) => !COMING_UP_KINDS.has(i.kind))
    .sort(
      (a, b) => b.when.getTime() - a.when.getTime() || a.id.localeCompare(b.id),
    )
    .slice(0, GROUP_CAP);
  return { comingUp, recent };
}
