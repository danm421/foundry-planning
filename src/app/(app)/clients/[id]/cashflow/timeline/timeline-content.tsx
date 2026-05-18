import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Fraunces, Outfit } from "next/font/google";
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

interface Props {
  id: string;
  firmId: string;
}

export async function TimelineContent({ id, firmId }: Props) {
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
