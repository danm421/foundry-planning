import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { TaxAnalysisContent } from "./tax-analysis-content";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; year?: string; scenario?: string }>;
}

export default async function TaxAnalysisPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;
  if (!(await findClientInFirm(id, firmId))) notFound();

  // `?year=` arrives absent, empty, or junk. `Number("")` is 0 — an integer —
  // so an empty param would pin the section to year zero and silently show
  // nothing. parseYear rejects all three and the section falls back to the
  // newest return on file.
  const year = parseYear(sp.year ?? "");

  return (
    <TaxAnalysisContent
      clientId={id}
      initialView={sp.view === "plan-vs-return" ? "plan-vs-return" : "report"}
      initialYear={year ?? undefined}
      // Base case only (spec decision 2): the scenario param the sidebar
      // preserves is acknowledged by Plan vs. Return with a note, never
      // applied — hence no DetailsPageShell here.
      scenarioIgnored={!!sp.scenario}
    />
  );
}
