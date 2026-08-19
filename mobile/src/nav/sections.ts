// mobile/src/nav/sections.ts
//
// Which destinations this app offers, given the advisor's portal feature
// switches. Pure — no react, no api imports.
//
// The mirror of `visiblePortalNavItems` on the web
// (src/components/portal/portal-nav-items.ts). Both surfaces have to agree:
// every gated section 403s at the API via `requirePortalFeature`, so a tab the
// phone still shows is a door onto an error screen. The switches arrive on
// GET /api/portal/me as `features`.
import type { PortalFeatureFlags } from "@contracts";

/** Every destination an advisor switch can hide, plus the core ones it can't. */
export type MobileSection =
  | "home"
  | "accounts"
  | "profile"
  | "privacy"
  | "budget"
  | "transactions"
  | "recurrings"
  | "investments";

/**
 * The switch that hides a destination, or undefined when the section is core
 * and always present.
 *
 * Transactions and Recurrings are tabs *inside* the web's Budget section
 * rather than rail entries of their own, so the Budget switch owns all three —
 * see the BUDGET_TABS note in portal-nav-items.ts.
 */
const SECTION_FEATURE: Readonly<
  Record<MobileSection, keyof PortalFeatureFlags | undefined>
> = {
  home: undefined,
  accounts: undefined,
  profile: undefined,
  privacy: undefined,
  budget: "budget",
  transactions: "budget",
  recurrings: "budget",
  investments: "investments",
};

/** Every section, for exhaustive iteration in tests and screens. */
export const MOBILE_SECTIONS = Object.keys(SECTION_FEATURE) as readonly MobileSection[];

/** False when the advisor has switched this section off for the client. */
export function isSectionVisible(
  section: MobileSection,
  features: PortalFeatureFlags,
): boolean {
  const feature = SECTION_FEATURE[section];
  return feature === undefined || features[feature];
}

export interface MoreLink {
  label: string;
  href: string;
  section: MobileSection;
}

/** The More tab's destinations, in display order. */
const MORE_LINKS: readonly MoreLink[] = [
  { label: "Investments", href: "/investments", section: "investments" },
  { label: "Recurrings", href: "/recurrings", section: "recurrings" },
  { label: "Profile", href: "/profile", section: "profile" },
  { label: "Privacy & sharing", href: "/privacy", section: "privacy" },
] as const;

/** The More rows this client can actually reach. */
export function visibleMoreLinks(features: PortalFeatureFlags): readonly MoreLink[] {
  return MORE_LINKS.filter((link) => isSectionVisible(link.section, features));
}
