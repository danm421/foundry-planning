import type { ReactElement } from "react";
import { LoadingLabel, Skeleton } from "@/components/skeleton";

/** Route fallback while the page reads the firm's Microsoft 365 state. Same
 *  frame as the page — header, then the calendar and to-do panes. */
export default function WorkspaceLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]" aria-busy="true">
      <LoadingLabel>Loading Workspace…</LoadingLabel>
      <div className="flex items-center justify-between">
        <Skeleton height="1.75rem" width="10rem" />
        <Skeleton height="2rem" width="18rem" radius="0.375rem" />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton height="360px" radius="0.75rem" />
        <Skeleton height="240px" radius="0.75rem" />
      </div>
    </div>
  );
}
