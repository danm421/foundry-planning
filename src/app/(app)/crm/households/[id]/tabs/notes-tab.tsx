import type { getCrmHousehold } from "@/lib/crm/households";
import { CrmNotesList } from "@/components/crm-notes-list";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

export function NotesTab({ household }: { household: Household }) {
  return <CrmNotesList householdId={household.id} />;
}
