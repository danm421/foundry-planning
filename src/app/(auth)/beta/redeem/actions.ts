"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { claimCode, finalizeCode, releaseCode } from "@/lib/billing/beta-codes";
import { createFounderOrgForUser } from "@/lib/billing/founder-init";
import { readPendingBeta, clearPendingBeta } from "@/lib/billing/beta-cookie";
import { checkBetaRedeemRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export type RedeemResult =
  | { ok: true; orgId: string }
  | { ok: false; error: string; needsManualEntry?: boolean };

export async function redeemBetaCode(manual?: { code: string; firmName: string }): Promise<RedeemResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "You need to be signed in." };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  const rl = await checkBetaRedeemRateLimit(ip);
  if (!rl.allowed) return { ok: false, error: "Too many attempts. Please wait a moment and try again." };

  const pending = manual ?? (await readPendingBeta());
  if (!pending) return { ok: false, error: "Enter your beta code to finish setup.", needsManualEntry: true };

  const firmName = pending.firmName.trim();
  if (!firmName) return { ok: false, error: "Enter your firm name.", needsManualEntry: true };

  const claim = await claimCode(pending.code, userId);
  if (!claim.ok) {
    const error =
      claim.reason === "already_used" ? "That code has already been used." : "That code isn't valid.";
    return { ok: false, error, needsManualEntry: true };
  }

  let firmId: string;
  try {
    ({ firmId } = await createFounderOrgForUser({
      ownerUserId: userId,
      displayName: firmName,
      entitlements: claim.entitlements,
    }));
  } catch (err) {
    // Compensating reset so the tester's code is reusable after a transient failure.
    // Guard the compensation itself — if releaseCode also fails we still return the
    // friendly error rather than throwing an unhandled exception at the client.
    try {
      await releaseCode(claim.id);
    } catch (releaseErr) {
      console.error("[beta-redeem] releaseCode compensation failed:", releaseErr);
    }
    console.error("[beta-redeem] founder org creation failed:", err);
    return {
      ok: false,
      error: "Something went wrong creating your firm. Please try again.",
      needsManualEntry: true,
    };
  }

  // The founder org now exists — past the point of no return. Backfilling the org
  // id and clearing the cookie are best-effort bookkeeping: a transient failure
  // here must NOT strand the tester with an org they can't activate, so we log and
  // proceed. The audit row + the claimed code already record the redemption.
  try {
    await finalizeCode(claim.id, firmId);
    await clearPendingBeta();
  } catch (err) {
    console.error("[beta-redeem] post-create bookkeeping failed (org already created):", err);
  }
  await recordAudit({
    action: "beta_code.redeemed",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: userId,
    metadata: { betaCodeId: claim.id, entitlements: claim.entitlements },
  });
  return { ok: true, orgId: firmId };
}
