import type { ReactElement } from "react";
import Breadcrumb from "./breadcrumb";
import { toggleSidebar } from "./sidebar";
import { ShareIcon, DownloadIcon, SparkleIcon, PanelLeftIcon } from "./icons";

interface TopbarProps {
  clientHouseholdTitle?: string;
}

export default function Topbar({ clientHouseholdTitle }: TopbarProps): ReactElement {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-hair bg-paper px-[var(--pad-card)]">
      <div className="flex items-center gap-2">
        <form action={toggleSidebar}>
          <button
            type="submit"
            aria-label="Toggle sidebar"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-card-hover hover:text-ink"
          >
            <PanelLeftIcon />
          </button>
        </form>
        <Breadcrumb clientHouseholdTitle={clientHouseholdTitle} />
      </div>
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
