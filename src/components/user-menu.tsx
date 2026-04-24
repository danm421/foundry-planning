"use client";

import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";

interface UserMenuProps {
  collapsed?: boolean;
}

export default function UserMenu({ collapsed = false }: UserMenuProps): ReactElement {
  return (
    <div
      className={
        collapsed
          ? "hidden"
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
        showName
      />
    </div>
  );
}
