// src/lib/presentations/pages/observations-next-steps/view-model.ts
// Pure data-transform: observation rows + token context + page options →
// render-ready view model. Framework-free (no Next/DB imports) — consumed by
// server-side PDF rendering as well as any future preview surface.

import { parseMarkdownToBlocks, type Block } from "../blank/markdown-blocks";
import { resolveAllTokens, renderTokens, type TokenContext } from "@/lib/plan-text/tokens";
import { OBSERVATION_TOPICS, TOPIC_LABELS } from "@/lib/schemas/observations";
import { dateLong } from "../../format";
import type { ObservationsPageOptions } from "./options-schema";

/** Narrow row shape — deliberately doesn't import the Drizzle row type so this
 *  module stays framework-free. `topic`/`owner`/`priority` are plain strings
 *  (not the DB enums) so callers don't need a drizzle import either. */
export interface ObservationsRowInput {
  section: "observation" | "next_step";
  topic: string;
  title: string | null;
  body: string;
  status: "open" | "in_progress" | "done";
  owner: string | null;
  priority: string | null;
  targetDate: string | null;
  sortOrder: number;
}

export interface ObservationsPageData {
  introBlocks: Block[];
  topicGroups: Array<{ topic: string; label: string; items: Block[][] }>;
  nextSteps: Array<{
    status: "open" | "in_progress" | "done";
    title: string | null;
    bodyBlocks: Block[];
    ownerLabel: string | null;
    dateLabel: string | null;
    priority: "high" | "medium" | "low" | null;
  }>;
  showOwnerAndDate: boolean;
}

const OWNER_LABELS: Record<string, string> = {
  advisor: "Advisor",
  client: "Client",
  joint: "Joint",
};

function ownerLabelFor(owner: string | null): string | null {
  if (!owner) return null;
  return OWNER_LABELS[owner] ?? owner;
}

const VALID_PRIORITIES = new Set(["high", "medium", "low"]);

function normalizePriority(priority: string | null): "high" | "medium" | "low" | null {
  return priority && VALID_PRIORITIES.has(priority) ? (priority as "high" | "medium" | "low") : null;
}

// Parses a "YYYY-MM-DD" target date via the local-time Date constructor
// (year, monthIndex, day) rather than `new Date(isoString)` — the latter
// parses as UTC midnight and can shift a day when formatted against local
// getMonth/getDate/getFullYear (see the Jan-1-DOB TZ off-by-one gotcha
// elsewhere in this codebase's import pipeline).
function formatTargetDate(targetDate: string | null): string | null {
  if (!targetDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!match) return null;
  const [, year, month, day] = match;
  return dateLong(new Date(Number(year), Number(month) - 1, Number(day)));
}

export function buildObservationsPageData(input: {
  rows: ObservationsRowInput[];
  ctx: TokenContext;
  options: ObservationsPageOptions;
}): ObservationsPageData {
  const { rows, ctx, options } = input;
  const tokenValues = resolveAllTokens(ctx);

  const introBlocks = parseMarkdownToBlocks(renderTokens(options.intro, tokenValues));

  const topicFilter = options.topics.length > 0 ? new Set(options.topics) : null;
  const sortedRows = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

  const includeObservations = options.include === "both" || options.include === "observations";
  const includeNextSteps = options.include === "both" || options.include === "nextSteps";

  const topicGroups: ObservationsPageData["topicGroups"] = [];
  if (includeObservations) {
    for (const topic of OBSERVATION_TOPICS) {
      if (topicFilter && !topicFilter.has(topic)) continue;
      const items = sortedRows
        .filter((r) => r.section === "observation" && r.topic === topic)
        .map((r) => parseMarkdownToBlocks(renderTokens(r.body, tokenValues)));
      if (items.length === 0) continue;
      topicGroups.push({ topic, label: TOPIC_LABELS[topic], items });
    }
  }

  const nextSteps: ObservationsPageData["nextSteps"] = [];
  if (includeNextSteps) {
    for (const row of sortedRows) {
      if (row.section !== "next_step") continue;
      if (topicFilter && !topicFilter.has(row.topic)) continue;
      if (!options.includeCompleted && row.status === "done") continue;
      nextSteps.push({
        status: row.status,
        title: row.title,
        bodyBlocks: parseMarkdownToBlocks(renderTokens(row.body, tokenValues)),
        ownerLabel: ownerLabelFor(row.owner),
        dateLabel: formatTargetDate(row.targetDate),
        priority: normalizePriority(row.priority),
      });
    }
  }

  return { introBlocks, topicGroups, nextSteps, showOwnerAndDate: options.showOwnerAndDate };
}
