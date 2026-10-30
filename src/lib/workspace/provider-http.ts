// src/lib/workspace/provider-http.ts
import type { ProviderTokenSet } from "./types";

/*
 * Plumbing the Google and Microsoft clients share. What each provider counts
 * as "busy", which hosts its token may go to, and how its errors read stay in
 * that provider's own client.
 */

/** A busy answer is retried this many times before the client gives up. */
export const MAX_BUSY_RETRIES = 2;
const DEFAULT_RETRY_AFTER_SEC = 1;
const MAX_RETRY_AFTER_SEC = 5;

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` in seconds; 0 is valid. Missing or unparseable → the default (1 s); at most 5 s. */
export function retryAfterMs(header: string | null): number {
  const sec = header === null || header.trim() === "" ? NaN : Number(header);
  const wait = Number.isFinite(sec) && sec >= 0 ? sec : DEFAULT_RETRY_AFTER_SEC;
  return Math.min(wait, MAX_RETRY_AFTER_SEC) * 1000;
}

/**
 * True when the path (before any query) has a `.` or `..` segment, plain or
 * percent-encoded. An event, list or task id can be one (`encodeURIComponent`
 * leaves dots alone), and the URL parser would then climb to the parent path.
 */
export function hasDotSegment(url: string): boolean {
  return url
    .split("?", 1)[0]
    .split("/")
    .some((segment) => /^(\.|%2e){1,2}$/i.test(segment));
}

/** Frees the connection of a response we won't read. */
export async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

/** A token-endpoint answer; `refreshToken` is null when the provider sent none. */
export type TokenResponse = Omit<ProviderTokenSet, "refreshToken"> & { refreshToken: string | null };

/**
 * One form-encoded POST to an OAuth token endpoint. A non-2xx throws
 * `authError` with the provider's `error` field (or `token_request_failed`);
 * a 2xx without an access token or a numeric `expires_in` throws
 * `invalid_token_response`. The body is read for those fields only; it is
 * never logged or kept, and neither is `error_description`.
 */
export async function postTokenRequest(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  authError: new (code: string, status?: number) => Error,
): Promise<TokenResponse> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = parseJsonObject(await res.text());
  if (!res.ok) {
    throw new authError(stringField(json, "error") ?? "token_request_failed", res.status);
  }
  const accessToken = stringField(json, "access_token");
  const expiresInSec = Number(json.expires_in);
  if (!accessToken || !Number.isFinite(expiresInSec)) {
    throw new authError("invalid_token_response", res.status);
  }
  return {
    accessToken,
    refreshToken: stringField(json, "refresh_token"),
    expiresInSec,
    scope: stringField(json, "scope") ?? "",
    idToken: stringField(json, "id_token"),
  };
}

/**
 * An id_token's payload, decoded WITHOUT verifying its signature; `{}` when it
 * isn't a three-part JWT or doesn't parse. Each caller says why that is safe
 * for the token it reads.
 */
export function readJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  return parts.length === 3 ? parseJsonObject(Buffer.from(parts[1], "base64url").toString("utf8")) : {};
}

/** A non-empty string field, or null. */
export function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Never throws: a JSON parse error's message quotes the text it choked on. */
function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(text);
    return typeof json === "object" && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
