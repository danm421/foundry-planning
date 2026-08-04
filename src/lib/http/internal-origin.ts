// src/lib/http/internal-origin.ts
//
// The PDF export routes re-enter our own API over HTTP to reuse the
// projection-data query, and they forward the caller's session cookie so that
// request authenticates as the caller. The origin for that call used to come
// from `new URL(request.url).origin` — which Next derives from the incoming
// `Host` / `X-Forwarded-Host` header. A request carrying a forged host would
// therefore send a signed-in advisor's session cookie to an attacker-chosen
// server, and return whatever that server answered as if it were our own
// projection data.
//
// Fix: resolve the origin against an allowlist of origins this deployment
// actually answers on. Anything else falls back to the configured app URL, so
// the export still works — it just can't be steered off-host.
//
// The allowlist is built from server-side env only. `VERCEL_URL` and friends
// are injected by the platform at build/run time, not by the request, so a
// caller cannot add an entry to it.

/** Last-resort origin, matching the convention used across the mailers. */
const DEFAULT_APP_ORIGIN = "https://app.foundryplanning.com";

function configuredOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return DEFAULT_APP_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/** Vercel exposes these without a scheme (`foo.vercel.app`). */
function vercelOrigin(host: string | undefined): string | null {
  if (!host) return null;
  try {
    return new URL(`https://${host}`).origin;
  } catch {
    return null;
  }
}

function isLocalDevOrigin(url: URL): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/** Origins this deployment legitimately serves from. */
function allowedInternalOrigins(): string[] {
  return [
    configuredOrigin(),
    vercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    vercelOrigin(process.env.VERCEL_URL),
    vercelOrigin(process.env.VERCEL_BRANCH_URL),
  ].filter((o): o is string => o !== null);
}

/**
 * The origin to use for a server-side call back into our own API.
 *
 * Prefers the request's own origin so preview deployments and local dev keep
 * calling themselves, but only when that origin is one we recognize. An
 * unrecognized (i.e. spoofed) host silently degrades to the configured app
 * origin rather than being trusted.
 */
export function trustedInternalOrigin(requestUrl: string): string {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return configuredOrigin();
  }
  if (isLocalDevOrigin(url)) return url.origin;
  return allowedInternalOrigins().includes(url.origin) ? url.origin : configuredOrigin();
}
