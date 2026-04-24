import { notFound } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import type { ReactElement } from "react";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import ClientHeader from "@/components/client-header";
import ClientTabs from "@/components/client-tabs";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientLayout({ children, params }: Props): Promise<ReactElement> {
  const { id } = await params;
  const firmId = await requireOrgId();

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!client || client.firmId !== firmId) notFound();

  const cc = await clerkClient();
  let advisorName = "Advisor";
  try {
    const advisor = await cc.users.getUser(client.advisorId);
    advisorName =
      [advisor.firstName, advisor.lastName].filter(Boolean).join(" ").trim() ||
      advisor.emailAddresses?.[0]?.emailAddress ||
      "Advisor";
  } catch {
    // advisor user deleted / not found — fall back to "Advisor"
  }

  return (
    <>
      <ClientHeader client={client} advisorName={advisorName} />
      <ClientTabs clientId={id} />
      <section className="px-[var(--pad-card)] py-6">{children}</section>
    </>
  );
}
