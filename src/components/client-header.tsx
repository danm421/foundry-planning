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
  return (
    <div className="sticky top-14 z-30 flex h-[44px] items-center gap-3 border-b border-hair bg-paper px-[var(--pad-card)]">
      <ClientIdentityMenu clientId={clientId} people={people} />
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
    </div>
  );
}
