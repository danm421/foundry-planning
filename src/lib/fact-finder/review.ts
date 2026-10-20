// src/lib/fact-finder/review.ts
/**
 * Pass 2 (D12), for the review route and the Claude connector: builds the
 * change list from the fact finder and stores it as `factFinder.changeSet` —
 * nothing is written to the plan. Session-free: the caller has run the gate
 * and hands over the state it read.
 */
import { formatUsage, inUsageScope, newUsageReport, totalTokensOf } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { REVIEW_READING_MESSAGE, REVIEW_STALE_MESSAGE, type ReviewRefusal } from "./api-types";
import { countLines, type ChangeSet } from "./change-set";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "./persist";
import { buildChangeSet } from "./placement/build";
import { checkLinks, dropLinks, type LinkedRow } from "./placement/links";
import { filesReading } from "./reading-status";
import { loadRecordBook } from "./records/book";
import { resolveBaseCaseScenarioId } from "./records/load";
import { relinkBaseCase } from "./relink";
import type { FactFinderState } from "./types";

export type ReviewOutcome =
  | { ok: true; changeSet: ChangeSet; factFinder: FactFinderState }
  | { ok: false; status: 409; body: ReviewRefusal };

const refuse = (body: ReviewRefusal): ReviewOutcome => ({ ok: false, status: 409, body });

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"`; past three, the first three and "and N more". */
function namesOf(rows: readonly LinkedRow[]): string {
  const names = rows.slice(0, 3).map((r) => `"${r.label}"`);
  if (rows.length > 3) return `${names.join(", ")} and ${rows.length - 3} more`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function vanishedMessage(rows: readonly LinkedRow[]): string {
  return rows.length === 1
    ? `1 link pointed at a record that's no longer on the plan — ${namesOf(rows)}. Check it and review again.`
    : `${rows.length} links pointed at records that are no longer on the plan — ${namesOf(rows)}. Check them and review again.`;
}

/** Another write landed first: the caller gets the fact finder as it is now. */
async function stale(scope: FactFinderScope, state: FactFinderState): Promise<ReviewOutcome> {
  return refuse({ error: REVIEW_STALE_MESSAGE, factFinder: (await loadFactFinder(scope)) ?? state });
}

/**
 * Refused while a document is reading or a "Links to" needs the advisor (D11);
 * a link to a record that's gone is dropped and re-scored first, so the fact
 * finder the caller goes back to shows which rows to check. `runLeftovers` is
 * the AI step for what nothing else places — it fails soft, and `null` builds
 * the list without it. Without `actorId`, audit rows name the session's actor.
 */
export async function reviewFactFinder(
  scope: FactFinderScope,
  state: FactFinderState,
  opts: {
    now: Date;
    actorId?: string;
    runLeftovers: Parameters<typeof buildChangeSet>[0]["runLeftovers"] | null;
  },
): Promise<ReviewOutcome> {
  const { importId, clientId, firmId } = scope;
  const { now, actorId } = opts;
  const started = Date.now();

  if (filesReading(state, now).length > 0) return refuse({ error: REVIEW_READING_MESSAGE });

  const book = await loadRecordBook(clientId, firmId, await resolveBaseCaseScenarioId(clientId));
  const links = checkLinks(state, book);
  if (links.vanished.length > 0) {
    const relinked = await relinkBaseCase(dropLinks(state, new Set(links.vanished.map((r) => r.rowId))), clientId);
    const written = await writeFactFinder(scope, state.version, relinked);
    if (!written) return stale(scope, state);
    await recordAudit({
      action: "import.payload.edited",
      resourceType: "client_import",
      resourceId: importId,
      clientId,
      firmId,
      actorId,
      metadata: {
        surface: "fact_finder_review",
        importId,
        // Where each dropped link sat and the record it named — the trace a link to another client's record leaves.
        droppedLinks: links.vanished.map(({ sectionId, rowId, recordId }) => ({ sectionId, rowId, recordId })),
        version: written.version,
      },
    });
    return refuse({ error: vanishedMessage(links.vanished), factFinder: written, rows: links.vanished.map((r) => r.rowId) });
  }
  if (links.needsClick > 0) {
    return refuse({ error: links.needsClick === 1 ? "1 link needs a click first." : `${links.needsClick} links need a click first.` });
  }
  if (links.doubles.length > 0) {
    const { rows } = links.doubles[0];
    const error = `${namesOf(rows)} ${rows.length === 2 ? "both" : "all"} link to the same record — change one of them.`;
    return refuse({ error, rows: rows.map((r) => r.rowId) });
  }

  // The AI step fails soft (not set up, a timeout, a bad reply): the list builds without it.
  const run = opts.runLeftovers ?? (async () => null);
  const usage = newUsageReport();
  const leftovers = { items: 0, failed: false };
  const built = await inUsageScope(usage, () =>
    buildChangeSet({
      state,
      book,
      now,
      runLeftovers: async (items, drafts) => {
        leftovers.items = items.length;
        const output = await run(items, drafts);
        leftovers.failed = output === null;
        return output;
      },
    }),
  );
  console.log(`[fact-finder-review] import ${importId}: ${built.lines.length} lines in ${Date.now() - started} ms — ${formatUsage(usage)}`);

  const changeSet = { ...built, builtAtVersion: state.version + 1 };
  const written = await writeFactFinder(scope, state.version, { ...state, changeSet }, { keepChangeSet: true });
  if (!written) return stale(scope, state);

  await recordAudit({
    action: "import.fact_finder_reviewed",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    actorId,
    metadata: {
      lines: changeSet.lines.length,
      ...countLines(changeSet.lines),
      aiPlaced: changeSet.lines.filter((l) => l.aiPlaced === true).length,
      leftovers: leftovers.items,
      leftoversFailed: leftovers.failed,
      totalTokens: totalTokensOf(usage),
    },
  });
  return { ok: true, changeSet, factFinder: written };
}
