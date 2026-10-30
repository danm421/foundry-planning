// src/lib/workspace/microsoft/graph.ts
import type { WorkspaceConnection } from "../connections";
import { ProviderRequestError, ProviderThrottledError } from "../errors";
import { MAX_BUSY_RETRIES, defaultSleep, discardBody, hasDotSegment, retryAfterMs } from "../provider-http";
import { getAccessToken } from "./token";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Graph's "busy" answers: throttled, unavailable, gateway timeout. */
const BUSY_STATUSES = new Set([429, 503, 504]);

export type GraphContext = {
  conn: WorkspaceConnection;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Cancels the Graph requests (not a token refresh) once it aborts. */
  signal?: AbortSignal;
};

/**
 * One Graph call, acting with `ctx.conn`. `path` is relative to v1.0 and
 * starts with `/`. `timeZone` (a Windows or IANA name) asks Graph for
 * wall-clock times in that zone via `Prefer: outlook.timezone`.
 *
 * - A `.` or `..` path segment (an id that would climb to the parent path,
 *   e.g. `/me/events/..` is `/me`) throws `ProviderRequestError` 404 before
 *   any request.
 * - A 401 forces one token refresh and one retry.
 * - A 429/503/504 waits `Retry-After` seconds (default 1, at most 5) and
 *   retries up to twice, then throws `ProviderThrottledError`.
 * - Any other non-2xx throws `ProviderRequestError` with Graph's `error.code`.
 *   The body is read for that code only; it is never logged or kept.
 *
 * Retries resend `init.body`, so pass a string, not a stream.
 */
export async function graphFetch(
  ctx: GraphContext,
  path: string,
  init: RequestInit & { timeZone?: string } = {},
): Promise<Response> {
  if (hasDotSegment(path)) throw new ProviderRequestError("microsoft", 404, null, null);
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

    const res = await fetchImpl(`${GRAPH_BASE}${path}`, { ...requestInit, headers, signal: ctx.signal });
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
      if (busyRetries >= MAX_BUSY_RETRIES) throw new ProviderThrottledError("microsoft", requestId);
      busyRetries++;
      await sleep(retryAfterMs(res.headers.get("retry-after")));
      continue;
    }
    throw new ProviderRequestError("microsoft", res.status, await readGraphCode(res), requestId);
  }
}

/** A JSON-body request for `graphJson`; `timeZone` as in `graphFetch`. */
export const jsonInit = (method: string, body: unknown, timeZone?: string) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  timeZone,
});

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

/**
 * Every item of a paged Graph collection. Follows `@odata.nextLink`, which is
 * an absolute URL: it is turned back into a path, and anything outside
 * Graph v1.0 is refused so the bearer token never goes elsewhere.
 */
export async function graphPages<T>(
  ctx: GraphContext,
  path: string,
  init?: RequestInit & { timeZone?: string },
): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graphJson(ctx, next, init);
    items.push(...page.value);
    const link: string | undefined = page["@odata.nextLink"];
    if (link !== undefined && !link.startsWith(`${GRAPH_BASE}/`)) {
      throw new Error("Refusing to follow a nextLink outside Microsoft Graph");
    }
    next = link?.slice(GRAPH_BASE.length);
  }
  return items;
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
