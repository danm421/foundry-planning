"use client";

import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";
import { useSidebar } from "./sidebar-provider";
import { ShieldIcon } from "./icons";

export default function UserMenu({
  isOpsAdmin = false,
}: {
  isOpsAdmin?: boolean;
}): ReactElement {
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
      >
        {isOpsAdmin && (
          <UserButton.MenuItems>
            <UserButton.Link
              label="Foundry Ops"
              labelIcon={<ShieldIcon width={16} height={16} />}
              href="/admin"
            />
          </UserButton.MenuItems>
        )}
      </UserButton>
    </div>
  );
}
