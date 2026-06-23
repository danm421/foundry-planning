"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  KeyIcon,
  MailIcon,
  EyeIcon,
  PencilIcon,
  HistoryIcon,
} from "@/components/portal/portal-icons";

type TabKey = "access" | "intake" | "preview" | "editing" | "activity";

interface Tab {
  key: TabKey;
  label: string;
  icon: ReactElement;
}

const TABS: readonly Tab[] = [
  { key: "access", label: "Access", icon: <KeyIcon /> },
  { key: "intake", label: "Intake form", icon: <MailIcon /> },
  { key: "preview", label: "Preview", icon: <EyeIcon /> },
  { key: "editing", label: "Editing", icon: <PencilIcon /> },
  { key: "activity", label: "Activity", icon: <HistoryIcon /> },
] as const;

interface Props {
  access: ReactNode;
  intake: ReactNode;
  preview: ReactNode;
  editing: ReactNode;
  activity: ReactNode;
}

/**
 * Left-nav shell for the advisor "Manage Portal" page. Mirrors the client
 * Details sidebar pattern (sticky bordered aside, accent-active nav items) so
 * the page reads as native chrome, but uses client-side tab state instead of
 * routes: the section cards call `router.refresh()` after mutations, and a soft
 * refresh preserves this component's `active` state while the server re-renders
 * fresh panels. Panels stay mounted (toggled with `hidden`) so in-progress form
 * input survives a tab switch.
 */
export default function PortalManageShell({
  access,
  intake,
  preview,
  editing,
  activity,
}: Props): ReactElement {
  const [active, setActive] = useState<TabKey>("access");
  const panels: Record<TabKey, ReactNode> = { access, intake, preview, editing, activity };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <nav
        aria-label="Manage portal sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-[100px] md:mx-0 md:flex-col md:overflow-visible md:border-r md:border-hair md:px-0 md:pr-4 md:pb-0"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => setActive(tab.key)}
              className={`flex shrink-0 items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors md:w-full ${
                isActive
                  ? "border-accent bg-card-2 text-accent"
                  : "border-transparent text-ink-3 hover:bg-card-2 hover:text-ink-2"
              }`}
            >
              <span className={isActive ? "text-accent" : "text-ink-4"} aria-hidden="true">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 max-w-2xl">
        {TABS.map((tab) => (
          <div key={tab.key} className={active === tab.key ? "" : "hidden"}>
            {panels[tab.key]}
          </div>
        ))}
      </div>
    </div>
  );
}
