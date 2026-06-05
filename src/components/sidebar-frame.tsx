"use client";

import type { ReactElement, ReactNode } from "react";
import { useSidebar } from "./sidebar-provider";

// The fixed-position column that holds the sidebar. Its width animates with the
// client collapsed state, so a collapse triggered during navigation (the layout
// is preserved across sibling routes) is instant rather than waiting on a
// server round-trip.
export default function SidebarFrame({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { collapsed } = useSidebar();
  return (
    <div
      className="fixed left-0 top-0 z-30 h-screen"
      style={{
        width: collapsed ? 64 : 240,
        transition: "width 0.22s ease",
      }}
    >
      {children}
    </div>
  );
}
