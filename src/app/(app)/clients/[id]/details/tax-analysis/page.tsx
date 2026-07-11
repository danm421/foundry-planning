import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { TaxAnalysisContent } from "./tax-analysis-content";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TaxAnalysisPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  if (!(await findClientInFirm(id, firmId))) notFound();
  return <TaxAnalysisContent clientId={id} />;
}
