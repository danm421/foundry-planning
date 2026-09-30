import AssumptionsClient from "./assumptions-client";
import { loadAssumptionsViewProps } from "./load-view-props";

interface AssumptionsContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function AssumptionsContent({ clientId: id, scenarioParam }: AssumptionsContentProps) {
  const result = await loadAssumptionsViewProps(id, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  if (result.status === "no-plan-settings") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No plan settings found.
      </div>
    );
  }

  return (
    // Wide enough for the Tax Rates tab's two columns of setting cards; still
    // capped so a line of body copy never runs the width of an ultrawide.
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Assumptions</h2>
        <p className="mt-1 text-sm text-ink-2">
          Plan horizon, tax rates, growth assumptions, and withdrawal order.
        </p>
      </div>

      <AssumptionsClient {...result.props} />
    </div>
  );
}
