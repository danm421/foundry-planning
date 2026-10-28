// src/lib/workspace/microsoft/graph.ts
import type { WorkspaceConnection } from "../connections";
import { GraphRequestError, GraphThrottledError } from "../errors";
import { getAccessToken } from "./token";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Graph's "busy" answers: throttled, unavailable, gateway timeout. */
const BUSY_STATUSES = new Set([429, 503, 504]);
const MAX_BUSY_RETRIES = 2;
const DEFAULT_RETRY_AFTER_SEC = 1;
const MAX_RETRY_AFTER_SEC = 5;

export type GraphContext = {
  conn: WorkspaceConnection;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One Graph call, acting with `ctx.conn`. `path` is relative to v1.0 and
 * starts with `/`. `timeZone` (a Windows or IANA name) asks Graph for
 * wall-clock times in that zone via `Prefer: outlook.timezone`.
 *
 * - A 401 forces one token refresh and one retry.
 * - A 429/503/504 waits `Retry-After` seconds (default 1, at most 5) and
 *   retries up to twice, then throws `GraphThrottledError`.
 * - Any other non-2xx throws `GraphRequestError` with Graph's `error.code`.
 *   The body is read for that code only; it is never logged or kept.
 *
 * Retries resend `init.body`, so pass a string, not a stream.
 */
export async function graphFetch(
  ctx: GraphContext,
  path: string,
  init: RequestInit & { timeZone?: string } = {},
): Promise<Response> {
  const { timeZone, ...requestInit } = init;
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const sleep = ctx.sleep ?? defaultSleep;

  let token = await getAccessToken(ctx.conn);
  let refreshed = false;
  let busyRetries = 0;
  for (;;) {
    const headers = new Headers(requestInit.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (timeZone) headers.append("prefer", `outlook.timezone="${timeZone}"`);

    const res = await fetchImpl(`${GRAPH_BASE}${path}`, { ...requestInit, headers });
    if (res.ok) return res;

    const requestId = res.headers.get("request-id");
    if (res.status === 401 && !refreshed) {
      await discardBody(res);
      refreshed = true;
      token = await getAccessToken(ctx.conn, { forceRefresh: true });
      continue;
    }
    if (BUSY_STATUSES.has(res.status)) {
      await discardBody(res);
      if (busyRetries >= MAX_BUSY_RETRIES) throw new GraphThrottledError(requestId);
      busyRetries++;
      await sleep(retryAfterMs(res.headers.get("retry-after")));
      continue;
    }
    throw new GraphRequestError(res.status, await readGraphCode(res), requestId);
  }
}

/** `graphFetch` + JSON. A 202/204 has no body and resolves `undefined`. */
export async function graphJson<T>(
  ctx: GraphContext,
  path: string,
  init?: RequestInit & { timeZone?: string },
): Promise<T> {
  const res = await graphFetch(ctx, path, init);
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** `Retry-After` in seconds; 0 is valid. Missing or unparseable → the default. */
function retryAfterMs(header: string | null): number {
  const sec = header === null || header.trim() === "" ? NaN : Number(header);
  const wait = Number.isFinite(sec) && sec >= 0 ? sec : DEFAULT_RETRY_AFTER_SEC;
  return Math.min(wait, MAX_RETRY_AFTER_SEC) * 1000;
}

/** Graph's `error.code`, or null. Never throws, and never lets the body out. */
async function readGraphCode(res: Response): Promise<string | null> {
  try {
    const json = JSON.parse(await res.text()) as { error?: { code?: unknown } } | null;
    const code = json?.error?.code;
    return typeof code === "string" && code !== "" ? code : null;
  } catch {
    return null;
  }
}

/** Frees the connection of a response we won't read before retrying. */
async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}
