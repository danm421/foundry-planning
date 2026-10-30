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

/**
 * How long one account's provider call may take. A provider that hangs rather
 * than answering would otherwise hold every other account's half of the week
 * (and the Foundry tasks beside the to-dos) until the function times out.
 */
export const ACCOUNT_DEADLINE_MS = 15_000;

/** One account's provider call outlived `ACCOUNT_DEADLINE_MS`. */
class AccountDeadlineError extends Error {
  constructor() {
    super("Workspace account call timed out");
    this.name = "AccountDeadlineError";
  }
}

/** `call`'s answer, or an `AccountDeadlineError` once the deadline passes first. The call itself isn't cancelled. */
async function withDeadline<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AccountDeadlineError()), ACCOUNT_DEADLINE_MS);
  });
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** A log line for one account's failure: its ids and `safeErrorFields` only, never the email or message. */
function warnAccount(what: string, err: unknown, conn: WorkspaceConnection): void {
  console.warn(what, { connectionId: conn.id, provider: conn.provider, ...safeErrorFields(err) });
}

/** One account's failure as the pane shows it. A missed deadline is `unavailable`. */
function toAccountError(err: unknown, conn: WorkspaceConnection): AccountError {
  if (err instanceof WorkspaceReconnectRequiredError) return "needs_reconnect";
  if (err instanceof ProviderThrottledError) return "throttled";
  warnAccount("Workspace account read failed:", err, conn);
  return "unavailable";
}

/**
 * The first valid zone any connected account reports (in the given order); UTC
 * when none does. An account that fails or misses the deadline has no say, and
 * is logged.
 */
export async function resolveDisplayZone(
  connections: WorkspaceConnection[],
  adapters: AdapterLookup = adapterFor,
): Promise<{ timeZone: string; fallback: boolean }> {
  for (const conn of connections) {
    if (conn.status !== "connected") continue;
    try {
      const zone = await withDeadline(adapters(conn.provider).getTimeZone(conn));
      if (zone && isValidIanaZone(zone)) return { timeZone: zone, fallback: false };
    } catch (err) {
      warnAccount("Workspace time zone read failed:", err, conn);
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
      const events = await withDeadline(adapters(conn.provider).listEvents(conn, { startDate, days, timeZone }));
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
      return { ...base, todos: await withDeadline(adapters(conn.provider).listOpenTodos(conn)), error: null };
    } catch (err) {
      return { ...base, todos: null, error: toAccountError(err, conn) };
    }
  });
}
