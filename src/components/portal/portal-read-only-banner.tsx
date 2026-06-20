import type { ReactElement } from "react";

export default function PortalReadOnlyBanner(): ReactElement {
  return (
    <div className="bg-warn/10 border-b border-warn/40 px-5 py-2 text-[12px] text-warn">
      Editing is disabled. Contact your advisor to make changes.
    </div>
  );
}
