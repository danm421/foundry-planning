"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import type { ReactElement } from "react";
import { useEndImpersonation } from "./impersonation-banner";
import { useSidebar } from "./sidebar-provider";
import { ShieldIcon, ShieldOffIcon } from "./icons";

export default function UserMenu({
  isOpsAdmin = false,
}: {
  isOpsAdmin?: boolean;
}): ReactElement {
  const { collapsed } = useSidebar();
  // An ops operator signed in as this user gets no account menu (profile,
  // email, password, passkeys): changes there go straight to Clerk under the
  // user's own name. Only a way out.
  const { actor } = useAuth();
  const { ending, end } = useEndImpersonation();
  return (
    <div
      className={
        collapsed
          ? "flex items-center justify-center px-2 py-3"
          : "flex items-center gap-3 px-[var(--pad-card)] py-3"
      }
    >
      {actor ? (
        <button
          type="button"
          onClick={end}
          disabled={ending}
          aria-label="End session"
          title={collapsed ? "End session" : undefined}
          className="flex items-center gap-2 text-[13px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
        >
          <ShieldOffIcon width={16} height={16} aria-hidden />
          {collapsed ? null : ending ? "Ending…" : "End session"}
        </button>
      ) : (
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
      )}
    </div>
  );
}
