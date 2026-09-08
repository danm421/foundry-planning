// src/app/api/cron/trial-feedback/route.ts
//
// GET /api/cron/trial-feedback -- hourly Vercel Cron (vercel.ts, 30 * * * *).
//
// Auth: Bearer CRON_SECRET, same as every other cron route here.
//
// Hourly rather than daily so the note lands ~24h after the cancellation
// instead of somewhere in a 24-48h smear. Most runs find nothing and send
// nothing, which is the expected shape.
//
// SENDING IS OFF until TRIAL_FEEDBACK_EMAIL_ENABLED=true. Without it the run
// still selects and reports its recipients but posts nothing — that dry run is
// how you see who a real run would write to before it writes to them.
import { type NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import {
  TRIAL_FEEDBACK_AUDIT_ACTION,
  TRIAL_FEEDBACK_RESOURCE_TYPE,
  dropAlreadySent,
  findTrialCancellations,
  isTrialFeedbackEnabled,
  resolveRecipient,
  sendTrialFeedbackEmail,
} from "@/lib/billing/trial-feedback";

export const dynamic = "force-dynamic";

type Outcome = "sent" | "failed" | "dry_run" | "no_contact";

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isTrialFeedbackEnabled();
  const pending = await dropAlreadySent(await findTrialCancellations());

  const results: Array<{
    firmId: string;
    firmName: string | null;
    to: string | null;
    outcome: Outcome;
  }> = [];

  for (const candidate of pending) {
    const recipient = await resolveRecipient(candidate.firmId);
    if (!recipient) {
      results.push({
        firmId: candidate.firmId,
        firmName: candidate.firmName,
        to: null,
        outcome: "no_contact",
      });
      continue;
    }

    const base = {
      firmId: candidate.firmId,
      firmName: candidate.firmName,
      to: recipient.email,
    };

    if (!enabled) {
      results.push({ ...base, outcome: "dry_run" });
      continue;
    }

    const { delivered } = await sendTrialFeedbackEmail(recipient);
    if (!delivered) {
      // No audit row, so the next run tries this person again.
      results.push({ ...base, outcome: "failed" });
      continue;
    }

    await recordAudit({
      action: TRIAL_FEEDBACK_AUDIT_ACTION,
      resourceType: TRIAL_FEEDBACK_RESOURCE_TYPE,
      resourceId: candidate.subscriptionId,
      firmId: candidate.firmId,
      actorId: "system:trial-feedback",
      actorKind: "system",
      metadata: {
        to: recipient.email,
        canceledAt: candidate.canceledAt.toISOString(),
      },
    });
    results.push({ ...base, outcome: "sent" });
  }

  return NextResponse.json({
    enabled,
    pending: pending.length,
    sent: results.filter((r) => r.outcome === "sent").length,
    results,
  });
}
