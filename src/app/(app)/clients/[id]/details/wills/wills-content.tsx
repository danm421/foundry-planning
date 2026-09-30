import WillsPanel from "@/components/wills-panel";
import { loadWillsViewProps } from "./load-view-props";

interface WillsContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function WillsContent({ clientId: id, scenarioParam }: WillsContentProps) {
  const result = await loadWillsViewProps(id, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  return <WillsPanel {...result.props} />;
}
