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
        Previewing the client portal as{" "}
        <span className="font-semibold">{clientName || "this client"}</span>.
        Editing is{" "}
        <span className="font-semibold">{editEnabled ? "on" : "off"}</span> —{" "}
        {editEnabled
          ? "changes you make here save to the client's account."
          : "this is a read-only preview. Flip the client's edit toggle to make changes."}
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
