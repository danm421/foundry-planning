"use client";

import type { ReactElement } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  function closePreview(): void {
    // Works when the tab was opened via target="_blank" from the advisor app.
    window.close();
    // No-op on a direct URL visit — fall back to the advisor's portal tab.
    window.setTimeout(() => router.push(`/clients/${clientId}/portal`), 150);
  }

  return (
    // Opaque bg-paper underlay: the accent tint is translucent, and the banner
    // stays stuck above scrolling portal content.
    <div className="sticky top-0 z-30 bg-paper">
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
        <button
          type="button"
          onClick={closePreview}
          className="shrink-0 rounded-md border border-accent/40 px-2 py-0.5 text-[12px] text-accent hover:bg-accent/20"
        >
          Close preview
        </button>
      </div>
    </div>
  );
}
