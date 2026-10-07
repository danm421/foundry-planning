"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { claimCode, finalizeCode, releaseCode } from "@/lib/billing/beta-codes";
import { createFounderOrgForUser, FounderOrgSetupError } from "@/lib/billing/founder-init";
import { readPendingBeta, clearPendingBeta } from "@/lib/billing/beta-cookie";
import { checkBetaRedeemRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

// Same cap as Settings → Firm rename, so a founder never starts with a name they
// couldn't save there.
const FIRM_NAME_MAX_LENGTH = 80;
const CONTROL_CHARS = /\p{Cc}/u;

export type RedeemResult =
  | { ok: true; orgId: string }
  | { ok: false; error: string; needsManualEntry?: boolean };

export async function redeemBetaCode(manual?: { code: string; firmName: string }): Promise<RedeemResult> {
  const { userId, orgId } = await auth();
  if (!userId) return { ok: false, error: "You need to be signed in." };

  // One tester = one comped founder org. A user who already belongs to an org
  // must not redeem a second code into a second fully-comped workspace, even
  // with a valid single-use code (middleware lets org-having users reach here).
  if (orgId) return { ok: false, error: "You already have a workspace." };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
  const rl = await checkBetaRedeemRateLimit(ip);
  if (!rl.allowed) return { ok: false, error: "Too many attempts. Please wait a moment and try again." };

  const pending = manual ?? (await readPendingBeta());
  if (!pending) return { ok: false, error: "Enter your beta code to finish setup.", needsManualEntry: true };

  const firmName = pending.firmName.trim();
  if (!firmName) return { ok: false, error: "Enter your firm name.", needsManualEntry: true };
  if (firmName.length > FIRM_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Keep your firm name to ${FIRM_NAME_MAX_LENGTH} characters or fewer.`,
      needsManualEntry: true,
    };
  }
  if (CONTROL_CHARS.test(firmName)) {
    return { ok: false, error: "Your firm name has characters we can't use.", needsManualEntry: true };
  }

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
    console.error("[beta-redeem] founder org creation failed:", err);
    if (err instanceof FounderOrgSetupError) {
      // The org already exists (and may already be comped), so the code stays spent —
      // releasing it would let the same code set up another workspace. Tie the code to
      // that org and leave an audit row so the setup can be finished by hand.
      try {
        await finalizeCode(claim.id, err.orgId);
        // Forget the spent code so a refresh doesn't replace this message with
        // "already used"; the form stays closed for the same reason.
        await clearPendingBeta();
      } catch (finalizeErr) {
        console.error("[beta-redeem] could not record the org on the code:", finalizeErr);
      }
      await recordAudit({
        action: "beta_code.org_setup_failed",
        resourceType: "firm",
        resourceId: err.orgId,
        firmId: err.orgId,
        actorId: userId,
        metadata: { betaCodeId: claim.id, entitlements: claim.entitlements },
      });
      return {
        ok: false,
        error:
          "We couldn't finish setting up your firm. Please contact support@foundryplanning.com and we'll complete it for you.",
      };
    }
    // No org was created: compensating reset so the tester's code is reusable after a
    // transient failure. Guard the compensation itself — if releaseCode also fails we
    // still return the friendly error rather than throwing an unhandled exception.
    try {
      await releaseCode(claim.id);
    } catch (releaseErr) {
      console.error("[beta-redeem] releaseCode compensation failed:", releaseErr);
    }
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
