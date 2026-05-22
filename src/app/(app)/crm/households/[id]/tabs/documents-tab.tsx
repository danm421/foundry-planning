import type { getCrmHousehold } from "@/lib/crm/households";
import { CrmDocumentList } from "@/components/crm-document-list";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

export function DocumentsTab({ household }: { household: Household }) {
  return <CrmDocumentList householdId={household.id} />;
}
