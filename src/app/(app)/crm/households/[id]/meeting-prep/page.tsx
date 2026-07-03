import { notFound } from "next/navigation";
import { getCrmHousehold } from "@/lib/crm/households";
import { MeetingPrepWizard } from "./meeting-prep-wizard";

export default async function MeetingPrepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const household = await getCrmHousehold(id); // org-scoped; undefined when not visible
  if (!household || household.deletedAt) notFound();

  return (
    <MeetingPrepWizard
      householdId={household.id}
      householdName={household.name}
      hasPlanningClient={Boolean(household.planningClient)}
    />
  );
}
