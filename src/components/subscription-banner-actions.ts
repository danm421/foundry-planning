"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "sub-banner-dismissed";

/**
 * Per-session dismissal: cookie value is "{kind}:{dateKey}". When the
 * state changes (different kind or new period), the cookie no longer
 * matches and the banner re-renders.
 */
export async function dismissBanner(dismissKey: string): Promise<void> {
  // UI-suppression cookie only (httpOnly, no security impact) — but bound the
  // input so an arbitrary-length value never lands in the cookie jar. Shape is
  // "{kind}:{dateKey}"; 128 chars is far above any real key.
  if (
    typeof dismissKey !== "string" ||
    dismissKey.length === 0 ||
    dismissKey.length > 128
  ) {
    return;
  }
  const jar = await cookies();
  jar.set(COOKIE_NAME, dismissKey, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30d cap; state-change short-circuits sooner
  });
}
