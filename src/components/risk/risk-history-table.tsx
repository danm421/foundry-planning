import type { ClientRiskProfileEventRow } from "@/db/schema";
import { summarizeEvent } from "@/lib/risk/queries";
import { resolveActors } from "@/lib/activity/resolve-actors";

const TH =
  "px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * A null actorUserId means the event was never attributed to a person: an
 * RTQ the client submitted themselves, or a system-driven capacity
 * recompute. Distinguish the two rather than collapsing both to "System" --
 * a client's own answers are not a system action.
 */
function nullActorLabel(kind: ClientRiskProfileEventRow["kind"]): string {
  return kind === "rtq_completed" ? "Client" : "System";
}

/** Async server component -- resolves actor display names itself so callers
 *  only need to hand it the raw event rows. */
export async function RiskHistoryTable({
  events,
}: {
  events: ClientRiskProfileEventRow[];
}) {
  const actorIds = Array.from(
    new Set(events.map((e) => e.actorUserId).filter((id): id is string => id !== null)),
  );
  const actors = await resolveActors(actorIds);

  if (events.length === 0) {
    return <p className="text-sm text-ink-3">No history yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <table className="min-w-full divide-y divide-hair">
        <thead className="bg-card-2">
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Change</th>
            <th className={TH}>By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {events.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-4 py-2 text-sm text-ink-3">
                <span className="tabular">{formatDate(e.occurredAt)}</span>
              </td>
              <td className="px-4 py-2 text-sm text-ink">{summarizeEvent(e)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-sm text-ink-2">
                {e.actorUserId
                  ? (actors.get(e.actorUserId)?.name ?? "Former member")
                  : nullActorLabel(e.kind)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
