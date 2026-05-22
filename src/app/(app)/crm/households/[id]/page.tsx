import { notFound } from "next/navigation";
import { getCrmHousehold } from "@/lib/crm/households";
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
  return <HouseholdDetail household={household} initialTab={tab ?? "overview"} />;
}
