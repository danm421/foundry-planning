import type { getCrmHousehold } from "@/lib/crm/households";
import Vault from "@/components/vault/vault";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

export function DocumentsTab({ household }: { household: Household }) {
  return <Vault householdId={household.id} />;
}
