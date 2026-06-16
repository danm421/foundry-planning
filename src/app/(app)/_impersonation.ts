"use server";

import { auth } from "@clerk/nextjs/server";
import { recordImpersonationEnded } from "@/lib/ops/impersonation";

export async function endImpersonationAction(): Promise<void> {
  const { userId, orgId, actor } = await auth();
  if (actor?.sub && userId && orgId) {
    await recordImpersonationEnded({
      firmId: orgId,
      advisorUserId: userId,
      opsUserId: actor.sub,
    });
  }
}
