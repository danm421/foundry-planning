"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  KeyIcon,
  MailIcon,
  SlidersIcon,
  PencilIcon,
  HistoryIcon,
} from "@/components/portal/portal-icons";

type TabKey = "access" | "intake" | "features" | "editing" | "activity";

interface Tab {
  key: TabKey;
  label: string;
  icon: ReactElement;
}

const TABS: readonly Tab[] = [
  { key: "access", label: "Access", icon: <KeyIcon /> },
  { key: "intake", label: "Intake form", icon: <MailIcon /> },
  { key: "features", label: "Features", icon: <SlidersIcon /> },
  { key: "editing", label: "Editing", icon: <PencilIcon /> },
  { key: "activity", label: "Activity", icon: <HistoryIcon /> },
] as const;

/** A null slot drops its tab from the nav — used when the firm has no client
 *  portal, where only Access (the "not enabled" notice) and Intake apply. */
interface Props {
  access: ReactNode;
  intake: ReactNode;
  features: ReactNode | null;
  editing: ReactNode | null;
  activity: ReactNode | null;
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
  features,
  editing,
  activity,
}: Props): ReactElement {
  const [active, setActive] = useState<TabKey>("access");
  const panels: Record<TabKey, ReactNode> = { access, intake, features, editing, activity };
  // `access` is never null, so the default active tab always survives the filter.
  const tabs = TABS.filter((tab) => panels[tab.key] !== null);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <nav
        aria-label="Manage portal sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-[100px] md:mx-0 md:flex-col md:overflow-visible md:border-r md:border-hair md:px-0 md:pr-4 md:pb-0"
      >
        {tabs.map((tab) => {
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
        {tabs.map((tab) => (
          <div key={tab.key} className={active === tab.key ? "" : "hidden"}>
            {panels[tab.key]}
          </div>
        ))}
      </div>
    </div>
  );
}
