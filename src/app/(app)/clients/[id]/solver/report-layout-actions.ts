"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { userSolverReportLayout } from "@/db/schema";
import { resolveReportLayout, REPORT_KEYS } from "@/lib/solver/report-layout";

const SaveInput = z.array(
  z.object({ id: z.string(), visible: z.boolean() }),
);

/**
 * Upsert the acting advisor's solver report layout. Reconciles the incoming
 * list against REPORT_KEYS before storing, so we never persist stale/unknown
 * ids or an all-hidden layout. Returns { ok:false } on no-session or bad input;
 * the client reverts its optimistic state and toasts on false.
 */
export async function saveReportLayout(layout: unknown): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId) return { ok: false };

  const parsed = SaveInput.safeParse(layout);
  if (!parsed.success) return { ok: false };

  const clean = resolveReportLayout(parsed.data, REPORT_KEYS);

  try {
    await db
      .insert(userSolverReportLayout)
      .values({ clerkUserId: userId, layout: clean, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userSolverReportLayout.clerkUserId,
        set: { layout: clean, updatedAt: new Date() },
      });
  } catch (err) {
    console.error("[saveReportLayout] upsert failed:", err);
    return { ok: false };
  }
  return { ok: true };
}
