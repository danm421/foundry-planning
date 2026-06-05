import { and, eq } from "drizzle-orm";
import DetailsSidebar from "@/components/details-sidebar";
import ResumeQuickStartBanner from "@/components/quick-start/resume-quick-start-banner";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { quickStartResumeStep, type QuickStartState } from "@/lib/quick-start/state";

interface ClientDataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ClientDataLayout({
  children,
  params,
}: ClientDataLayoutProps) {
  const { id } = await params;
  const firmId = await requireOrgId();

  const [row] = await db
    .select({ state: clients.quickStartState })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  const resumeStep = quickStartResumeStep((row?.state as QuickStartState | null) ?? null);

  return (
    <div className="space-y-6">
      {resumeStep && <ResumeQuickStartBanner clientId={id} step={resumeStep} />}
      <div className="grid grid-cols-[220px_1fr] items-start gap-6">
        <aside className="sticky top-[100px] h-[calc(100vh-100px)] border-r border-hair pr-4">
          <DetailsSidebar clientId={id} quickStartResumeStep={resumeStep} />
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
