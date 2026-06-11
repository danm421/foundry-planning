"use server";

import { headers } from "next/headers";
import { validateCode } from "@/lib/billing/beta-codes";
import { setPendingBeta } from "@/lib/billing/beta-cookie";
import { checkBetaValidateRateLimit } from "@/lib/rate-limit";

export type ValidateActionResult = { ok: true } | { ok: false; error: string };

const REASON_COPY: Record<string, string> = {
  not_found: "That code isn't valid. Double-check it and try again.",
  redeemed: "That code has already been used.",
  revoked: "That code is no longer active.",
  expired: "That code has expired.",
};

export async function validateAndStash(code: string, firmName: string): Promise<ValidateActionResult> {
  const firm = firmName.trim();
  if (!firm) return { ok: false, error: "Enter your firm name." };
  if (!code.trim()) return { ok: false, error: "Enter your beta code." };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkBetaValidateRateLimit(ip);
  if (!rl.allowed) return { ok: false, error: "Too many attempts. Please wait a moment and try again." };

  const result = await validateCode(code);
  if (!result.valid) {
    return { ok: false, error: REASON_COPY[result.reason] ?? "That code isn't valid. Double-check it and try again." };
  }

  await setPendingBeta({ code, firmName: firm });
  return { ok: true };
}
