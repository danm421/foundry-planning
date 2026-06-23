import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  extractClientIp,
  checkIntakeAutosaveRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { intakeDraftSchema, type IntakePayload } from "@/lib/intake/schema";

export const dynamic = "force-dynamic";

// PATCH /api/intake/[token] — public (no auth), token-scoped autosave.
// Merges the partial draft payload into the stored form.
// Security: unguessable token + rate limiting + lenient draft schema.
// No audit on autosave (too noisy).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1. Rate limiting (keyed on token:ip)
  const ip = extractClientIp(req);
  const rl = await checkIntakeAutosaveRateLimit(`${token}:${ip}`);
  if (!rl.allowed) {
    return rateLimitErrorResponse(rl, "Too many autosave requests. Please slow down.");
  }

  // 2. Load form
  const form = await loadFormByToken(token);
  if (!form) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Expiry check
  if (isExpired(form, new Date())) {
    return NextResponse.json({ error: "This form link has expired." }, { status: 410 });
  }

  // 4. Status guard (only draft forms accept autosave)
  if (form.status !== "draft") {
    return NextResponse.json(
      { error: "This form has already been submitted." },
      { status: 409 },
    );
  }

  // 5. Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let parsedDraft: ReturnType<typeof intakeDraftSchema.parse>;
  try {
    parsedDraft = intakeDraftSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid payload", issues: err.issues },
        { status: 422 },
      );
    }
    throw err;
  }

  // 6. Merge + persist (top-level merge — wizard sends full current draft each save)
  // Cast: we're writing a draft (partial) into a column typed as IntakePayload.
  // The DB stores it as jsonb; the column type is a convenience alias — the real
  // constraint is the Zod schema we just validated against.
  const merged = { ...(form.payload ?? {}), ...parsedDraft } as unknown as IntakePayload;
  await db
    .update(intakeForms)
    .set({ payload: merged, updatedAt: new Date() })
    .where(eq(intakeForms.id, form.id));

  // 7. OK
  return NextResponse.json({ ok: true });
}
