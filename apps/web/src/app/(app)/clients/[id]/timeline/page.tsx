import { db } from "@foundry/db";
import { clients } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Fraunces, Outfit } from "next/font/google";
import { getOrgId } from "@/lib/db-helpers";
import TimelineReportView from "@/components/timeline-report-view";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TimelineReportPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return (
    <div className={`${fraunces.variable} ${outfit.variable}`}>
      <TimelineReportView clientId={id} />
    </div>
  );
}
