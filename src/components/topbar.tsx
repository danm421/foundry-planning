import type { ReactElement } from "react";
import Breadcrumb from "./breadcrumb";
import { ShareIcon, DownloadIcon, SparkleIcon } from "./icons";

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-hair bg-paper px-[var(--pad-card)]">
      <Breadcrumb clientHouseholdTitle={clientHouseholdTitle} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex items-center gap-2 rounded bg-card border border-hair px-3 py-1.5 text-[13px] text-ink-2 opacity-60"
        >
          <ShareIcon />
          Share
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex items-center gap-2 rounded bg-card border border-hair px-3 py-1.5 text-[13px] text-ink-2 opacity-60"
        >
          <DownloadIcon />
          Export
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex items-center gap-2 rounded bg-accent border border-accent-deep px-3 py-1.5 text-[13px] text-accent-on font-medium opacity-80"
        >
          <SparkleIcon />
          Prep for meeting
        </button>
      </div>
    </header>
  );
}
