import { notFound } from "next/navigation";
import { getCrmHousehold } from "@/lib/crm/households";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { HouseholdDetail } from "./household-detail";

export default async function CrmHouseholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const household = await getCrmHousehold(id);
  if (!household) notFound();
  const actors = await resolveActors([household.advisorId]);
  const advisorName = actors.get(household.advisorId)?.name ?? household.advisorId;
  return (
    <HouseholdDetail
      household={household}
      advisorName={advisorName}
      initialTab={tab ?? "overview"}
    />
  );
}
