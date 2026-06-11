"use client";

import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";
import { useSidebar } from "./sidebar-provider";

export default function UserMenu(): ReactElement {
  const { collapsed } = useSidebar();
  return (
    <div
      className={
        collapsed
          ? "flex items-center justify-center px-2 py-3"
          : "flex items-center gap-3 px-[var(--pad-card)] py-3"
      }
    >
      <UserButton
        appearance={{
          elements: {
            avatarBox: "h-8 w-8 rounded-full bg-gradient-to-br from-accent/60 to-cat-portfolio/60",
            userButtonBox: "flex items-center gap-3",
            userButtonOuterIdentifier: "text-[13px] text-ink font-medium",
          },
        }}
        showName={!collapsed}
      />
    </div>
  );
}
