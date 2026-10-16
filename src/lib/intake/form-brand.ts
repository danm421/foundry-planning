import { cache } from "react";
import { loadHouseholdBrand } from "@/lib/branding/household-brand";
import { formBrand, type BrandChoice } from "@/lib/branding/brand-choice";

/**
 * The brand a public intake page wears: the form's own, or for a form from
 * before the picker, what its email always carried — the household's brand,
 * else its creator's. React-cached on positional primitives so the page's
 * generateMetadata and render share one lookup (an object arg would miss).
 */
export const resolveFormBrand = cache(
  async (
    firmId: string,
    clientId: string | null,
    brand: string | null,
    createdByUserId: string,
  ): Promise<BrandChoice> => {
    if (brand) return brand;
    const household = clientId ? await loadHouseholdBrand(clientId, firmId) : null;
    return formBrand({ brand, createdByUserId }, household);
  },
);
