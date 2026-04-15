import { auth } from "@clerk/nextjs/server";

export async function getOrgId(): Promise<string> {
  const { orgId, userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  // Use orgId if available (multi-tenant), fall back to userId (single firm)
  return orgId ?? userId;
}
