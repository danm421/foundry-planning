import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import SettingsTabs from "@/components/settings-tabs";
import { currentUserIsBillingContact } from "@/lib/billing/billing-contact";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgRole }, isBillingContact, hdrs] = await Promise.all([
    auth(),
    currentUserIsBillingContact(),
    headers(),
  ]);

  // Best-effort pathname for tab highlighting; fall back to "/settings".
  const pathname = hdrs.get("x-pathname") ?? hdrs.get("next-url") ?? "/settings";

  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]">
      <div className="rounded border border-hair bg-card">
        <SettingsTabs role={orgRole ?? null} isBillingContact={isBillingContact} pathname={pathname} />
        <div className="p-[var(--pad-card)]">{children}</div>
      </div>
    </div>
  );
}
