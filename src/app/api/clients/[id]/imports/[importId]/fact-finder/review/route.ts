// src/app/api/clients/[id]/imports/[importId]/fact-finder/review/route.ts
import { formatUsage, inUsageScope, newUsageReport, totalTokensOf } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { countLines } from "@/lib/fact-finder/change-set";
import { REVIEW_READING_MESSAGE, REVIEW_STALE_MESSAGE, type ReviewRefusal, type ReviewResponse } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "@/lib/fact-finder/persist";
import { buildChangeSet } from "@/lib/fact-finder/placement/build";
import { runLeftovers } from "@/lib/fact-finder/placement/leftovers-run";
import { checkLinks, dropLinks, type LinkedRow } from "@/lib/fact-finder/placement/links";
import { filesReading } from "@/lib/fact-finder/reading-status";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { relinkBaseCase } from "@/lib/fact-finder/relink";
import { locateRow, readFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

export const dynamic = "force-dynamic";
// The record book, then one AI call that can take up to 90 s.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

const refuse = (body: ReviewRefusal) => jsonResponse(409, body);

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

/** Where a dropped link sat and the record it named — the trace a link to another client's record leaves. */
function droppedLink(state: FactFinderState, rowId: string) {
  const at = locateRow(state, rowId);
  const link = at ? state.sections[at.sectionId][at.index].link : undefined;
  return { sectionId: at?.sectionId ?? null, rowId, recordId: link?.kind === "existing" ? link.recordId : null };
}

/** Another write landed first: the advisor gets the fact finder as it is now. */
async function stale(scope: FactFinderScope, state: FactFinderState): Promise<Response> {
  return refuse({ error: REVIEW_STALE_MESSAGE, factFinder: (await loadFactFinder(scope)) ?? state });
}

/**
 * Pass 2 (D12): builds the change list from the fact finder and stores it as
 * `factFinder.changeSet` — nothing is written to the plan. Refused while a
 * document is reading or a "Links to" needs the advisor (D11); a link to a
 * record that's gone is dropped and re-scored first, so the fact finder the
 * advisor goes back to shows which rows to check.
 */
export async function POST(_request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "match");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId } = gate;
  const scope = { importId, clientId, firmId };
  const started = Date.now();
  const now = new Date(started);

  const state = readFactFinderState(gate.payloadJson);
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
      metadata: {
        surface: "fact_finder_review",
        importId,
        droppedLinks: links.vanished.map((r) => droppedLink(state, r.rowId)),
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
  const usage = newUsageReport();
  const leftovers = { items: 0, failed: false };
  const built = await inUsageScope(usage, () =>
    buildChangeSet({
      state,
      book,
      now,
      runLeftovers: async (items, drafts) => {
        leftovers.items = items.length;
        const output = await runLeftovers(items, drafts);
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
    metadata: {
      lines: changeSet.lines.length,
      ...countLines(changeSet.lines),
      aiPlaced: changeSet.lines.filter((l) => l.aiPlaced === true).length,
      leftovers: leftovers.items,
      leftoversFailed: leftovers.failed,
      totalTokens: totalTokensOf(usage),
    },
  });
  return jsonResponse(200, { factFinder: written } satisfies ReviewResponse);
}
