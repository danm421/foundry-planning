"use client";

import {
  uploadBrandingAsset,
  removeBrandingAsset,
  setPrimaryColorAction,
} from "./actions";
import { AssetCard, ColorCard, toFileFormData } from "./brand-cards";

type Initial = {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
};

export default function BrandingForm({ initial }: { initial: Initial }) {
  return (
    <div className="flex flex-col gap-6">
      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP. Up to 2 MB."
        accept="image/png,image/jpeg,image/webp"
        initialUrl={initial.logoUrl}
        previewClass="h-16 w-auto max-w-[240px] object-contain"
        onUpload={(file) => uploadBrandingAsset("logo", toFileFormData(file))}
        onRemove={() => removeBrandingAsset("logo")}
      />
      <AssetCard
        label="Favicon"
        helper="PNG. Up to 256 KB. Square (e.g. 32×32 or 64×64) recommended."
        accept="image/png"
        initialUrl={initial.faviconUrl}
        previewClass="h-8 w-8 object-contain"
        onUpload={(file) => uploadBrandingAsset("favicon", toFileFormData(file))}
        onRemove={() => removeBrandingAsset("favicon")}
      />
      <ColorCard initial={initial.primaryColor} onSave={setPrimaryColorAction} />
    </div>
  );
}
