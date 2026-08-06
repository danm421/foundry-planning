import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import {
  checkIntakeVerifyRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { matchesIntakeIdentity, gateCookieName, signGateSession } from "@/lib/intake/gate";
import { gateCookieOptions } from "@/lib/intake/gate-session";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/intake/[token]/verify — public (no auth), token-scoped identity gate.
// Body: { lastName, email }. On a match, mints a short-lived signed cookie that
// unlocks the form's contents for reading (page) and writing (autosave/submit).
//
// Holding the link is NOT sufficient to reach client data any more; the caller
// must also produce the recipient's own surname + email.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate limit keyed on the TOKEN ALONE, not token:ip. This is the
  //    brute-force surface, and an attacker holding the link can trivially
  //    rotate IPs — bounding attempts per form is what actually caps guessing.
  const rl = await checkIntakeVerifyRateLimit(token);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many attempts. Please wait an hour and try again, or contact your advisor.",
    );
  }

  // 2. Load form
  const form = await loadFormByToken(token);
  if (!form) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Expiry / status — mirror the page so the client sees a consistent story.
  if (isExpired(form, new Date())) {
    return NextResponse.json({ error: "This form link has expired." }, { status: 410 });
  }
  if (form.status !== "draft") {
    return NextResponse.json(
      { error: "This form has already been submitted." },
      { status: 409 },
    );
  }

  // 4. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { lastName, email } = (body ?? {}) as { lastName?: unknown; email?: unknown };
  if (typeof lastName !== "string" || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // 5. Match. The failure message is deliberately generic and identical for a
  //    wrong surname and a wrong email — telling the caller which half was right
  //    would turn this into an oracle for enumerating the recipient.
  if (!matchesIntakeIdentity(form, { lastName, email })) {
    await recordAudit({
      action: "intake.form.verify_failed",
      actorKind: "client",
      actorId: "system", // no Clerk session on the public intake flow
      firmId: form.firmId,
      clientId: form.clientId ?? null,
      resourceType: "intake_form",
      resourceId: form.id,
    });
    return NextResponse.json(
      { error: "That doesn't match our records. Please check and try again." },
      { status: 401 },
    );
  }

  // 6. Mint the session.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(gateCookieName(form.id), signGateSession(form.id), gateCookieOptions());

  // 7. Stamp first access. This is the seam — not the page render — because
  //    holding the link is not access: only a caller who produced the
  //    recipient's own surname + email has demonstrably opened the form.
  //    `isNull` lives in the WHERE, not in a read-then-write, so a re-verify
  //    (or two racing tabs) can never move the stamp forward off FIRST access.
  //    Deliberately does NOT touch `updated_at` — that column dates the
  //    History row for a discarded form, and opening a link is not an edit.
  //    Concurrent with the audit insert: different tables, neither reads the
  //    other, so the gate's success path pays the slower write, not the sum.
  await Promise.all([
    db
      .update(intakeForms)
      .set({ openedAt: new Date() })
      .where(and(eq(intakeForms.id, form.id), isNull(intakeForms.openedAt))),
    recordAudit({
      action: "intake.form.verified",
      actorKind: "client",
      actorId: "system",
      firmId: form.firmId,
      clientId: form.clientId ?? null,
      resourceType: "intake_form",
      resourceId: form.id,
    }),
  ]);

  return res;
}
