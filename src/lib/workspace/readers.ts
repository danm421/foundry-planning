// src/lib/workspace/readers.ts
import type { WorkspaceConnection } from "./connections";
import { MAX_ACCOUNTS_PER_ADVISOR } from "./accounts";
import { dedupeEvents } from "./dedupe";
import { ProviderThrottledError, WorkspaceReconnectRequiredError } from "./errors";
import { mapLimited } from "./map-limited";
import { adapterFor, type WorkspaceProviderAdapter } from "./provider-adapter";
import { safeErrorFields } from "./route-errors";
import { isValidIanaZone } from "./time-zones";
import type { AccountError, WorkspaceEvent, WorkspaceProvider, WorkspaceTodo } from "./types";

export type AdapterLookup = (p: WorkspaceProvider) => WorkspaceProviderAdapter;

/** One account's failure as the pane shows it. Logs ids and `safeErrorFields` only, never the email or message. */
function toAccountError(err: unknown, conn: WorkspaceConnection): AccountError {
  if (err instanceof WorkspaceReconnectRequiredError) return "needs_reconnect";
  if (err instanceof ProviderThrottledError) return "throttled";
  console.warn("Workspace account read failed:", {
    connectionId: conn.id,
    provider: conn.provider,
    ...safeErrorFields(err),
  });
  return "unavailable";
}

/** The first valid zone any connected account reports (in the given order); UTC when none does. */
export async function resolveDisplayZone(
  connections: WorkspaceConnection[],
  adapters: AdapterLookup = adapterFor,
): Promise<{ timeZone: string; fallback: boolean }> {
  for (const conn of connections) {
    if (conn.status !== "connected") continue;
    try {
      const zone = await adapters(conn.provider).getTimeZone(conn);
      if (zone && isValidIanaZone(zone)) return { timeZone: zone, fallback: false };
    } catch {
      // This account has no say in the zone; try the next.
    }
  }
  return { timeZone: "UTC", fallback: true };
}

type TaggedEvent = WorkspaceEvent & { connectionId: string; provider: WorkspaceProvider };

/**
 * The week across the advisor's shown accounts, in one display zone. A hidden
 * account is never read, so it can't win the dedupe for a meeting a shown one
 * also holds; the zone still comes from every account, hidden or not. `hidden`
 * ids that aren't among `connections` change nothing. `accounts` lists the
 * shown ones only.
 */
export async function readWeek(input: {
  connections: WorkspaceConnection[];
  hidden?: ReadonlySet<string>;
  startDate: string;
  days: number;
  adapters?: AdapterLookup;
}): Promise<{
  timeZone: string;
  timeZoneFallback: boolean;
  events: TaggedEvent[];
  accounts: Array<{ connectionId: string; error: AccountError | null }>;
}> {
  const { connections, hidden, startDate, days, adapters = adapterFor } = input;
  const { timeZone, fallback } = await resolveDisplayZone(connections, adapters);
  const shown = hidden ? connections.filter((c) => !hidden.has(c.id)) : connections;

  const results = await mapLimited(shown, MAX_ACCOUNTS_PER_ADVISOR, async (conn) => {
    if (conn.status !== "connected") return { events: [] as TaggedEvent[], error: "needs_reconnect" as AccountError };
    try {
      const events = await adapters(conn.provider).listEvents(conn, { startDate, days, timeZone });
      return {
        events: events.map((e) => ({ ...e, connectionId: conn.id, provider: conn.provider })),
        error: null,
      };
    } catch (err) {
      return { events: [] as TaggedEvent[], error: toAccountError(err, conn) };
    }
  });

  return {
    timeZone,
    timeZoneFallback: fallback,
    events: dedupeEvents(
      results.flatMap((r) => r.events),
      shown.map((c) => c.id),
    ),
    accounts: shown.map((c, i) => ({ connectionId: c.id, error: results[i].error })),
  };
}

export async function readTodos(input: {
  connections: WorkspaceConnection[];
  adapters?: AdapterLookup;
}): Promise<
  Array<{ connectionId: string; provider: WorkspaceProvider; todos: WorkspaceTodo[] | null; error: AccountError | null }>
> {
  const { connections, adapters = adapterFor } = input;
  return mapLimited(connections, MAX_ACCOUNTS_PER_ADVISOR, async (conn) => {
    const base = { connectionId: conn.id, provider: conn.provider };
    if (conn.status !== "connected") return { ...base, todos: null, error: "needs_reconnect" as const };
    try {
      return { ...base, todos: await adapters(conn.provider).listOpenTodos(conn), error: null };
    } catch (err) {
      return { ...base, todos: null, error: toAccountError(err, conn) };
    }
  });
}
