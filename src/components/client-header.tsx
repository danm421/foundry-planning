import type { ReactElement, ReactNode } from "react";
import ClientIdentityMenu, { type PersonInfo } from "@/components/client-identity-menu";
import { CLIENT_HEADER_ACTIONS_ID } from "@/components/client-header-actions";

interface ClientHeaderProps {
  clientId: string;
  people: PersonInfo[];
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export default function ClientHeader({
  clientId,
  people,
  centerSlot,
  rightSlot,
}: ClientHeaderProps): ReactElement {
  // Three-column grid (mirrors the topbar): identity menu left, sub-report tabs
  // centered, plan selector right — all on one row.
  //
  // z-[35] keeps this client chrome (and its dropdowns) above the report
  // content below, while staying below the topbar (z-40), whose hover menus
  // open down into this row.
  return (
    <div className="sticky top-14 z-[35] grid h-[44px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-hair bg-paper px-[var(--pad-card)]">
      <div className="min-w-0 justify-self-start">
        <ClientIdentityMenu clientId={clientId} people={people} />
      </div>
      <div className="justify-self-center">{centerSlot}</div>
      <div className="flex items-center gap-3 justify-self-end">
        {/* Route-level action slot, filled by <ClientHeaderActions> (portal) so
            a page can put controls on this row instead of spending its own
            vertical space. It leads the plan chrome, which keeps the plan
            selector and CRM link pinned to the same right edge on every route
            whether or not the page contributes actions. The divider rides on
            this slot (border-r) so empty:hidden collapses it, its padding and
            its gap together on routes that contribute nothing. */}
        <div
          id={CLIENT_HEADER_ACTIONS_ID}
          className="flex items-center gap-2 border-r border-hair-2 pr-3 empty:hidden"
        />
        {rightSlot}
      </div>
    </div>
  );
}
