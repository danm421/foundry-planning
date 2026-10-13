import type { ReactElement } from "react";
import { OrganizationProfile } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

export default async function TeamSettingsPage(): Promise<ReactElement> {
  // An ops operator signed in as this member gets no team management: changes
  // made in Clerk's panel reach us only as webhooks, which cannot name them.
  const { actor } = await auth();
  if (actor) {
    return (
      <div role="status" className="max-w-4xl rounded border border-hair bg-card p-4 text-sm text-ink-2">
        Team management is turned off while you&apos;re signed in as another user.
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <OrganizationProfile
        routing="hash"
        appearance={{
          elements: {
            profileSection__organizationDanger: { display: "none" },
          },
        }}
      />
    </div>
  );
}
