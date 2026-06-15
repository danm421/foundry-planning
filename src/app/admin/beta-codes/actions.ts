"use server";

import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireOpsAdmin } from "@/lib/ops/ops-auth";
import { mintCodes, revokeCode } from "@/lib/billing/beta-codes";
import { recordAudit } from "@/lib/audit";

export type MintResult = { ok: true; codes: string[] } | { ok: false; error: string };
export type RevokeResult = { ok: true } | { ok: false; error: string };

const MintInput = z.object({
  count: z.coerce.number().int().min(1).max(100),
  label: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd").nullable().optional(),
  entitlements: z.array(z.string().trim()).optional(),
});

export async function mintCodesAction(input: unknown): Promise<MintResult> {
  try {
    await requireOpsAdmin();
  } catch {
    return { ok: false, error: "Not authorized." };
  }
  const parsed = MintInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the form values and try again." };
  const { count, label, expiresAt, entitlements } = parsed.data;
  const ents = entitlements && entitlements.length ? entitlements : ["ai_import"];
  const expiry = expiresAt ? new Date(`${expiresAt}T23:59:59Z`) : null;

  const codes = await mintCodes({ count, label, expiresAt: expiry, entitlements: ents });

  const { userId, orgId } = await auth();
  await recordAudit({
    action: "beta_code.minted",
    resourceType: "beta_code",
    resourceId: "batch",
    firmId: orgId ?? "system",
    actorId: userId ?? undefined,
    metadata: { count, label, entitlements: ents, expiresAt: expiry?.toISOString() ?? null },
  });
  return { ok: true, codes };
}

export async function revokeCodeAction(id: string): Promise<RevokeResult> {
  try {
    await requireOpsAdmin();
  } catch {
    return { ok: false, error: "Not authorized." };
  }
  if (!id || typeof id !== "string") return { ok: false, error: "Missing code id." };
  await revokeCode(id);
  const { userId, orgId } = await auth();
  await recordAudit({
    action: "beta_code.revoked",
    resourceType: "beta_code",
    resourceId: id,
    firmId: orgId ?? "system",
    actorId: userId ?? undefined,
  });
  revalidatePath("/admin/beta-codes");
  return { ok: true };
}
