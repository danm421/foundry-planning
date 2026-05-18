import { getBranding } from "@/lib/branding/db";
import BrandingForm from "./branding-form";

interface Props {
  orgId: string;
}

export async function BrandingContent({ orgId }: Props) {
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
