// src/app/(app)/clients/[id]/reports/page.tsx
//
// Server component listing the reports for a client. Firm-scopes the
// client lookup before the reports query (matches the wills/scenarios
// pattern) and surfaces a "New report" dialog via the client component
// in `./new-report-button`.

import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { clients, reports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { NewReportButton } from "./new-report-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportsListPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      templateKey: reports.templateKey,
      updatedAt: reports.updatedAt,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(and(eq(reports.clientId, id), eq(reports.firmId, firmId)))
    .orderBy(desc(reports.updatedAt));

  return (
    <div className="px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[24px] font-semibold text-ink">Reports</h1>
        <NewReportButton clientId={id} />
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-hair bg-card p-8 text-center text-ink-3">
          No reports yet. Click <span className="text-ink">New report</span> to start.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/clients/${id}/reports/${r.id}`}
                className="block rounded-md border border-hair bg-card hover:bg-card-2 p-4 transition"
              >
                <div className="text-[15px] font-medium text-ink">{r.title}</div>
                <div className="text-[12px] font-mono text-ink-3 mt-1">
                  {r.templateKey ?? "blank"} · updated{" "}
                  {new Date(r.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
