// src/lib/branding/brand-choice.ts
import { z } from "zod";

/**
 * Which brand a client-facing surface carries: the firm's own, or one
 * advisor's overlay on it (`advisor_profiles`, applied only while that
 * advisor's `brandingEnabled` is on). One short value, so a household, an
 * intake form and a presentation request can all carry it: `"firm"`, or the
 * advisor's Clerk user id. Client-safe — no IO.
 */
export const FIRM_BRAND = "firm";
export type BrandChoice = string;

export type BrandOption = { value: BrandChoice; label: string };

/**
 * What a screen needs to offer the brand picker. Both lists come back empty
 * when the viewer can't pick (`loadBrandPicker`), so an advisor's browser never
 * receives the rest of the firm's brand list.
 */
export type BrandPicker = {
  /** Brands this viewer may pick. */
  options: BrandOption[];
  /** Every brand turned on in the firm — labels a default the viewer couldn't pick themselves. */
  allBrands: BrandOption[];
};

/** A brand arriving in a request body. Clerk user ids run ~32 characters. */
export const brandChoiceSchema = z.string().trim().min(1).max(64);

/** The advisor whose overlay a brand names, or null for the firm's own. */
export function brandAdvisorOf(choice: BrandChoice): string | null {
  return choice === FIRM_BRAND ? null : choice;
}

/** A household's brand: its saved choice, else its own advisor's. */
export function householdBrand(client: { brand: string | null; advisorId: string }): BrandChoice {
  return client.brand ?? client.advisorId;
}

/**
 * The brand an intake form carries. Every send since the picker writes one; a
 * form from before it resolves the way it always did — the household's brand,
 * or for a prospect form the person who created it.
 */
export function formBrand(
  form: { brand?: string | null; createdByUserId: string },
  household: BrandChoice | null,
): BrandChoice {
  return form.brand ?? household ?? form.createdByUserId;
}

/**
 * An advisor brand that isn't turned on renders exactly as the firm brand, so
 * the picker shows it as the firm. `allBrands` is `listFirmBrands`' output.
 */
export function normalizeBrand(choice: BrandChoice, allBrands: readonly BrandOption[]): BrandChoice {
  return allBrands.some((b) => b.value === choice) ? choice : FIRM_BRAND;
}

/** Whether to show the picker at all: one brand (or none) is not a choice. */
export function canPickBrand(picker: BrandPicker): boolean {
  return picker.options.length > 1;
}

/**
 * The dropdown's choices: what the viewer may pick, plus the current value
 * when it isn't one of those (an admin set a brand this planner can't use), so
 * the selection still shows what the household actually has.
 */
export function brandChoicesFor(picker: BrandPicker, current: BrandChoice): BrandOption[] {
  if (picker.options.some((o) => o.value === current)) return picker.options;
  const extra = picker.allBrands.find((b) => b.value === current);
  return extra ? [...picker.options, extra] : picker.options;
}
