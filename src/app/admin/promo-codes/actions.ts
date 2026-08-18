"use server";

import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { createPromoCode, deactivatePromoCode } from "@/lib/billing/promo-codes";
import { recordAudit } from "@/lib/audit";

export type CreateResult = { ok: true; code: string } | { ok: false; error: string };
export type DeactivateResult = { ok: true } | { ok: false; error: string };

const CreateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .transform((v) => v || null),
    discountKind: z.enum(["percent", "amount"]),
    // Under 100, not up to it: 100% off bills $0 on every plan.
    percentOff: z.coerce.number().positive().lt(100).nullable().optional(),
    amountOffDollars: z.coerce.number().positive().nullable().optional(),
    years: z.coerce.number().int().min(1).max(5),
    maxRedemptions: z.coerce.number().int().min(1).max(10_000),
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd")
      .nullable()
      .optional(),
    firstTimeOnly: z.boolean().optional(),
  })
  // The discount amount lives in one of two fields depending on the kind, so
  // the required-ness is cross-field and can't be expressed on either alone.
  .refine((v) => (v.discountKind === "percent" ? v.percentOff != null : v.amountOffDollars != null), {
    message: "Enter the discount amount.",
  });

export async function createPromoCodeAction(input: unknown): Promise<CreateResult> {
  try {
    await requireOpsAdmin();
  } catch {
    return { ok: false, error: "Not authorized." };
  }
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the form values and try again." };
  const v = parsed.data;

  // Stripe rejects a redemption cutoff in the past. Say so in our own words —
  // its message names a unix timestamp, which is not something to hand back.
  const expiry = v.expiresAt ? new Date(`${v.expiresAt}T23:59:59Z`) : null;
  if (expiry && expiry.getTime() <= Date.now()) {
    return { ok: false, error: "The last day to redeem has to be in the future." };
  }

  const discount =
    v.discountKind === "percent"
      ? ({ kind: "percent", percentOff: v.percentOff! } as const)
      : // Dollars are what ops types; Stripe bills in cents.
        ({ kind: "amount", amountOffCents: Math.round(v.amountOffDollars! * 100) } as const);

  let created: { id: string; code: string };
  try {
    created = await createPromoCode({
      name: v.name,
      code: v.code,
      discount,
      years: v.years,
      maxRedemptions: v.maxRedemptions,
      expiresAt: expiry,
      firstTimeOnly: v.firstTimeOnly ?? false,
    });
  } catch (err) {
    // Surfaces both our own validation copy and Stripe's own message (e.g. a
    // duplicate code), which is the actionable thing for whoever is on the form.
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the promo code." };
  }

  const { userId, orgId } = await auth();
  await recordAudit({
    action: "promo_code.created",
    resourceType: "promo_code",
    resourceId: created.id,
    firmId: orgId ?? "system",
    actorId: userId ?? undefined,
    metadata: {
      code: created.code,
      name: v.name,
      discount,
      years: v.years,
      maxRedemptions: v.maxRedemptions,
      expiresAt: v.expiresAt ?? null,
      firstTimeOnly: v.firstTimeOnly ?? false,
    },
  });
  revalidatePath("/admin/promo-codes");
  return { ok: true, code: created.code };
}

export async function deactivatePromoCodeAction(id: string): Promise<DeactivateResult> {
  try {
    await requireOpsAdmin();
  } catch {
    return { ok: false, error: "Not authorized." };
  }
  if (!id || typeof id !== "string") return { ok: false, error: "Missing promo code id." };

  try {
    await deactivatePromoCode(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not deactivate the code." };
  }

  const { userId, orgId } = await auth();
  await recordAudit({
    action: "promo_code.deactivated",
    resourceType: "promo_code",
    resourceId: id,
    firmId: orgId ?? "system",
    actorId: userId ?? undefined,
  });
  revalidatePath("/admin/promo-codes");
  return { ok: true };
}
