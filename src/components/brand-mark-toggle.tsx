"use client";

import type { ReactElement } from "react";
import { FoundryMark } from "./icons";
import { useSidebar } from "./sidebar-provider";

export default function BrandMarkToggle(): ReactElement {
  const { collapsed, toggle } = useSidebar();

  const size = collapsed ? 66 : 84;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="flex shrink-0 items-center justify-center rounded-md text-ink hover:bg-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <FoundryMark width={size} height={size} />
    </button>
  );
}
