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
        {rightSlot}
        {/* Route-level action slot, filled by <ClientHeaderActions> (portal) so
            a page can put controls on this row instead of spending its own
            vertical space. It trails the plan chrome deliberately: a page's
            primary action is an accent fill and so is the scenario chip, and
            side by side they read as one teal blob with no way to tell the
            action from the state. empty:hidden collapses the divider and its
            gap on routes that contribute nothing. */}
        <div
          id={CLIENT_HEADER_ACTIONS_ID}
          className="flex items-center gap-2 border-l border-hair-2 pl-3 empty:hidden"
        />
      </div>
    </div>
  );
}
