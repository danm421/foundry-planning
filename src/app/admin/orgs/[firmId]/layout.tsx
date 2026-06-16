import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms } from "@/db/schema";
import OrgTabs from "./_org-tabs";

export const dynamic = "force-dynamic";

export default async function OrgDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin/orgs" className="text-xs text-sky-300 hover:underline">
          &larr; All organizations
        </Link>
        <h1 className="text-lg font-medium">{firm.displayName ?? "(unnamed)"}</h1>
        <p className="font-mono text-xs text-neutral-500">{firm.firmId}</p>
      </div>
      <OrgTabs firmId={firmId} />
      {children}
    </div>
  );
}
