"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ReactElement } from "react";
import { PanelLeftIcon } from "./icons";

interface SidebarToggleProps {
  collapsed: boolean;
}

export default function SidebarToggle({ collapsed }: SidebarToggleProps): ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function handleClick() {
    const next = collapsed ? "0" : "1";
    document.cookie = `sidebar-collapsed=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-end"} border-b border-hair px-[var(--pad-card)] py-3 text-ink-3 hover:bg-card-hover hover:text-ink`}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
    >
      <PanelLeftIcon />
    </button>
  );
}
