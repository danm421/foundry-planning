import Link from "next/link";
import type { ReactElement } from "react";

interface Props {
  clientId: string;
  clientName: string;
  editEnabled: boolean;
}

export default function PortalPreviewBanner({
  clientId,
  clientName,
  editEnabled,
}: Props): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-accent/40 bg-accent/10 px-5 py-2 text-[12px] text-accent">
      <div>
        Previewing client portal as{" "}
        <span className="font-semibold">{clientName || "this client"}</span> —
        read-only. Client edit toggle is{" "}
        <span className="font-semibold">{editEnabled ? "on" : "off"}</span>.
      </div>
      <Link
        href={`/clients/${clientId}/portal`}
        className="rounded-md border border-accent/40 px-2 py-0.5 text-[12px] text-accent hover:bg-accent/20"
      >
        Exit preview
      </Link>
    </div>
  );
}
