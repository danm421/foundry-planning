import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import SettingsTabs from "@/components/settings-tabs";
import { SubscriptionGuard } from "@/components/subscription-guard";
import { getSubscriptionState } from "@/lib/billing/subscription-state";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgRole, sessionClaims }, hdrs, state] = await Promise.all([
    auth(),
    headers(),
    getSubscriptionState(),
  ]);
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  // Best-effort pathname for tab highlighting; fall back to "/settings".
  const pathname = hdrs.get("x-pathname") ?? hdrs.get("next-url") ?? "/settings";

  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]">
      <SubscriptionGuard state={state} isFounder={isFounder} />
      <div className="rounded border border-hair bg-card">
        <SettingsTabs role={orgRole ?? null} pathname={pathname} />
        <div className="p-[var(--pad-card)]">{children}</div>
      </div>
    </div>
  );
}
