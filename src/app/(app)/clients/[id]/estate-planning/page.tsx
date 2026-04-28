import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import { CanvasFrame } from "./canvas-frame";
import { CanvasDndProvider } from "./dnd-context-provider";

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

  const withResult = runProjectionWithEvents(tree);

  const clientFirstName = tree.client.firstName;
  // spouseName from ClientInfo is the full spouse name; use it as the display name
  const spouseFirstName = tree.client.spouseName ?? null;

  return (
    <CanvasDndProvider
      clientId={clientId}
      clientFirstName={clientFirstName}
      spouseFirstName={spouseFirstName}
      tree={tree}
    >
      <CanvasFrame tree={tree} withResult={withResult} />
    </CanvasDndProvider>
  );
}
