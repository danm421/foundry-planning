import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";
import { buildOrgRows } from "@/lib/ops/org-rows";
import OrgsClient from "./orgs-client";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["trialing", "active", "past_due", "unpaid"];

export default async function OrgsPage() {
  const [firmRows, subRows] = await Promise.all([
    db.select().from(firms).orderBy(desc(firms.createdAt)),
    db.select().from(subscriptions).where(inArray(subscriptions.status, ACTIVE_STATUSES)),
  ]);
  const rows = buildOrgRows(firmRows, subRows);
  return <OrgsClient rows={rows} />;
}
