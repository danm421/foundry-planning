// src/lib/workspace/google/api.ts
import type { WorkspaceConnection } from "../connections";
import { ProviderRequestError, ProviderThrottledError } from "../errors";
import { MAX_BUSY_RETRIES, defaultSleep, discardBody, retryAfterMs } from "../provider-http";
import { getAccessToken } from "./token";

/** The only places a Google access token is ever sent. */
const ALLOWED_URL_PREFIXES = [
  "https://www.googleapis.com/calendar/v3/",
  "https://tasks.googleapis.com/tasks/v1/",
];

/** Google's "busy" answers. A 403 is busy too when its reason is a rate limit. */
const BUSY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

export type GoogleContext = {
  conn: WorkspaceConnection;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * One Google Calendar or Tasks call, acting with `ctx.conn`. `url` is absolute
 * and must start with a Calendar v3 or Tasks v1 base; anything else throws
 * before a token is refreshed or sent.
 *
 * - A 401 forces one token refresh and one retry.
 * - A 429/500/502/503/504, or a 403 whose reason is `rateLimitExceeded` /
 *   `userRateLimitExceeded`, waits `Retry-After` seconds (default 1, at most
 *   5) and retries up to twice, then throws `ProviderThrottledError`.
 * - Any other non-2xx throws `ProviderRequestError` with Google's
 *   `error.errors[0].reason`. The body is read for that reason only; it is
 *   never logged or kept. Google sends no request-id header, so it is null.
 *
 * Retries resend `init.body`, so pass a string, not a stream.
 */
export async function googleFetch(
  ctx: GoogleContext,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const href = normalizedHref(url);
  if (href === null || !ALLOWED_URL_PREFIXES.some((prefix) => href.startsWith(prefix))) {
    throw new Error("Refusing to send a Google token outside the Calendar and Tasks APIs");
  }
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const sleep = ctx.sleep ?? defaultSleep;

  let token = await getAccessToken(ctx.conn);
  let refreshed = false;
  let busyRetries = 0;
  for (;;) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);

    const res = await fetchImpl(href, { ...init, headers });
    if (res.ok) return res;

    if (res.status === 401 && !refreshed) {
      await discardBody(res);
      refreshed = true;
      token = await getAccessToken(ctx.conn, { forceRefresh: true });
      continue;
    }
    // Only a 403 needs its reason to tell "rate limited" from "forbidden", but
    // reading it here also frees a busy response's connection before the retry.
    const reason = await readGoogleReason(res);
    const busy =
      BUSY_STATUSES.has(res.status) || (res.status === 403 && reason !== null && RATE_LIMIT_REASONS.has(reason));
    if (busy) {
      if (busyRetries >= MAX_BUSY_RETRIES) throw new ProviderThrottledError("google", null);
      busyRetries++;
      await sleep(retryAfterMs(res.headers.get("retry-after")));
      continue;
    }
    throw new ProviderRequestError("google", res.status, reason, null);
  }
}

/** The URL as the network will resolve it (dot-segments collapsed), or null when it isn't an absolute URL. */
function normalizedHref(url: string): string | null {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

/** `googleFetch` + JSON. A 204 has no body and resolves `undefined`. */
export async function googleJson<T>(ctx: GoogleContext, url: string, init?: RequestInit): Promise<T> {
  const res = await googleFetch(ctx, url, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Every item of a paged Google collection. Follows `nextPageToken` by asking
 * for the same URL again with `pageToken` set, so the host never changes.
 */
export async function googlePages<T>(ctx: GoogleContext, url: string, itemsKey: "items"): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page: { items?: T[]; nextPageToken?: string } = await googleJson(
      ctx,
      pageToken ? withPageToken(url, pageToken) : url,
    );
    items.push(...(page[itemsKey] ?? []));
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return items;
}

function withPageToken(url: string, pageToken: string): string {
  const next = new URL(url);
  next.searchParams.set("pageToken", pageToken);
  return next.toString();
}

/** Google's `error.errors[0].reason`, or null. Never throws, and never lets the body out. */
async function readGoogleReason(res: Response): Promise<string | null> {
  try {
    const json = JSON.parse(await res.text()) as { error?: { errors?: { reason?: unknown }[] } } | null;
    const reason = json?.error?.errors?.[0]?.reason;
    return typeof reason === "string" && reason !== "" ? reason : null;
  } catch {
    return null;
  }
}
