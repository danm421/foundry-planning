import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { PlanVsReturnContent } from "./plan-vs-return-content";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; scenario?: string }>;
}

export default async function PlanVsReturnPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;
  if (!(await findClientInFirm(id, firmId))) notFound();

  // `?year=` arrives absent, empty, or junk. `Number("")` is 0 — an integer —
  // so an empty param would pin the page to year zero and silently show
  // nothing. parseYear rejects all three and the page falls back to the newest
  // return on file.
  const year = parseYear(sp.year ?? "");

  // Base case only (spec decision 2): the scenario param the sidebar preserves
  // is acknowledged with a note, never applied — hence no DetailsPageShell here.
  return (
    <PlanVsReturnContent
      clientId={id}
      initialYear={year ?? undefined}
      scenarioIgnored={!!sp.scenario}
    />
  );
}
