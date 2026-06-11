"use client";

import type { ReactElement, ReactNode } from "react";
import { useSidebar } from "./sidebar-provider";

// The app grid reserves the first column for the fixed sidebar. Its width tracks
// the client collapsed state in lockstep with <SidebarFrame> (same 64↔240 range
// and easing), so expanding the sidebar pushes the topbar and content right
// instead of letting the fixed sidebar overlay — and paint under — the topbar.
export default function AppShell({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { collapsed } = useSidebar();
  return (
    <div
      className="grid min-h-screen"
      style={{
        gridTemplateColumns: `${collapsed ? 64 : 240}px 1fr`,
        transition: "grid-template-columns 0.22s ease",
      }}
    >
      {children}
    </div>
  );
}
