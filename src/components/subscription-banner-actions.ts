"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "sub-banner-dismissed";

/**
 * Per-session dismissal: cookie value is "{kind}:{dateKey}". When the
 * state changes (different kind or new period), the cookie no longer
 * matches and the banner re-renders.
 */
export async function dismissBanner(dismissKey: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, dismissKey, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30d cap; state-change short-circuits sooner
  });
}
