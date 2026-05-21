import type { getCrmHousehold } from "@/lib/crm/households";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

export function DocumentsTab({ household }: { household: Household }) {
  void household;
  return <div className="text-ink-3">TODO — filled in Phase 5</div>;
}
