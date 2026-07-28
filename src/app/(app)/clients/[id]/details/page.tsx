import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function ClientDataIndex({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = sp.scenario ? `?scenario=${encodeURIComponent(sp.scenario)}` : "";

  const firmId = await requireOrgId();
  const [row] = await db
    .select({ mode: clients.detailsViewMode })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  const landing = row?.mode === "map" ? "map" : "net-worth";
  redirect(`/clients/${id}/details/${landing}${qs}`);
}
