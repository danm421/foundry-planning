import TechniquesView from "@/components/techniques-view";
import { loadTechniquesViewProps } from "./load-view-props";

interface TechniquesContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function TechniquesContent({ clientId: id, scenarioParam }: TechniquesContentProps) {
  const result = await loadTechniquesViewProps(id, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  return <TechniquesView {...result.props} />;
}
