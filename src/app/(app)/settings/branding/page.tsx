import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { getBranding } from "@/lib/branding/db";
import Forbidden from "../forbidden";
import BrandingForm from "./branding-form";

export default async function BrandingSettingsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="admin or owner" />;
    }
    throw err;
  }

  const { orgId } = await auth();
  if (!orgId) return <Forbidden requiredRole="admin or owner" />;

  const branding = (await getBranding(orgId)) ?? {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-medium text-ink">Branding</h1>
      <p className="text-sm text-ink-3">
        Upload your firm&apos;s logo and favicon and pick a primary color. These
        assets will be used in reports.
      </p>
      <BrandingForm initial={branding} />
    </div>
  );
}
