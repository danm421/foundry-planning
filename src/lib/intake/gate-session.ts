import { cookies } from "next/headers";
import { gateCookieName, verifyGateSession, GATE_SESSION_MS } from "./gate";

/**
 * Cookie IO for the public intake identity gate. Kept apart from `gate.ts` so
 * the crypto and name-matching stay framework-free and unit-testable; this file
 * is the only Next-coupled piece.
 */

/** True when the caller has already proved their identity for this form. */
export async function isGateVerified(formId: string): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(gateCookieName(formId))?.value;
  return verifyGateSession(raw, formId);
}

/**
 * Cookie options for a minted gate session.
 *
 * path is "/" because the session has to travel to both the page
 * (`/intake/<token>`) and the API routes (`/api/intake/<token>/…`), which share
 * no common prefix. The cookie is per-form and httpOnly, so the cost is a few
 * dozen bytes on unrelated requests.
 */
export function gateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(GATE_SESSION_MS / 1000),
  };
}
