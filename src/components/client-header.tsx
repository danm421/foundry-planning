import type { ReactElement, ReactNode } from "react";
import ClientIdentityMenu, { type PersonInfo } from "@/components/client-identity-menu";

interface ClientHeaderProps {
  clientId: string;
  people: PersonInfo[];
  rightSlot?: ReactNode;
}

export default function ClientHeader({
  clientId,
  people,
  rightSlot,
}: ClientHeaderProps): ReactElement {
  // z-[35] keeps this client chrome (and its dropdowns) above the report
  // subtab bars — which are sticky z-30 and later in the DOM, so a z-30 header
  // loses the stacking tie and its popovers get painted over — while staying
  // below the topbar (z-40), whose hover menus open down into this row.
  return (
    <div className="sticky top-14 z-[35] flex h-[44px] items-center gap-3 border-b border-hair bg-paper px-[var(--pad-card)]">
      <ClientIdentityMenu clientId={clientId} people={people} />
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
    </div>
  );
}
