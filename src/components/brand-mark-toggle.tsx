"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ReactElement } from "react";
import { FoundryMark } from "./icons";

interface BrandMarkToggleProps {
  collapsed: boolean;
}

export default function BrandMarkToggle({
  collapsed,
}: BrandMarkToggleProps): ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function handleClick() {
    const next = collapsed ? "0" : "1";
    document.cookie = `sidebar-collapsed=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  const size = collapsed ? 44 : 56;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="flex shrink-0 items-center justify-center rounded-md text-ink hover:bg-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <FoundryMark width={size} height={size} />
    </button>
  );
}
