import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { CanvasFrame } from "./canvas-frame";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstatePlanningPage({ params }: PageProps) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();

  let tree;
  try {
    const result = await loadEffectiveTree(clientId, firmId, "base", {});
    tree = result.effectiveTree;
  } catch (e) {
    if (e instanceof Error && /not found|no base case/i.test(e.message)) {
      notFound();
    }
    throw e;
  }

  return <CanvasFrame tree={tree} />;
}
