import type { ReactElement } from "react";
import { OrganizationProfile } from "@clerk/nextjs";

export default function TeamSettingsPage(): ReactElement {
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
