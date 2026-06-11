import { cookies } from "next/headers";

// httpOnly (JS can't read it) but NOT signed: it carries only the tester's own
// code (a secret they already hold) + their firm name. Tampering buys nothing —
// the atomic server-side claim in beta-codes.ts is the real gate.
const COOKIE_NAME = "fp_beta_pending";
const MAX_AGE_SECONDS = 60 * 60; // 1h — covers a sign-up that pauses for email verification.

export type PendingBeta = { code: string; firmName: string };

export async function setPendingBeta(data: PendingBeta): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, JSON.stringify(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readPendingBeta(): Promise<PendingBeta | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingBeta;
    if (typeof parsed?.code === "string" && typeof parsed?.firmName === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function clearPendingBeta(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
