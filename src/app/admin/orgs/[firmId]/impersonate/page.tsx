import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import ImpersonateClient from "./impersonate-client";

export const dynamic = "force-dynamic";

export default async function ImpersonatePage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const members = await listFirmMembers(firmId);
  return <ImpersonateClient firmId={firmId} members={members} />;
}
