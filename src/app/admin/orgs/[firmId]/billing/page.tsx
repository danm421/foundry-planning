import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { loadFirmBilling } from "@/lib/ops/billing-admin";
import BillingClient from "./billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const billing = await loadFirmBilling(firmId);
  return <BillingClient firmId={firmId} isFounder={firm.isFounder} billing={billing} />;
}
