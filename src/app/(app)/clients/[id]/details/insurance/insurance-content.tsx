import InsurancePanel from "@/components/insurance-panel";
import DisabilityPanel from "@/components/disability-panel";
import { loadInsuranceViewProps } from "./load-view-props";

interface InsuranceContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function InsuranceContent({ clientId: id, scenarioParam }: InsuranceContentProps) {
  const result = await loadInsuranceViewProps(id, scenarioParam);

  if (result.status === "no-base-case") {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <InsurancePanel {...result.props} />
      <DisabilityPanel {...result.disabilityProps} />
    </div>
  );
}
