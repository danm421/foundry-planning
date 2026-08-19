// Advisor-controlled portal feature switches — which optional sections a
// client can reach in their portal. The mirror image of `privacy.ts`, which is
// the *client* controlling what the advisor sees.
//
// Pure constants and types only (no `@/db` import) so client components — the
// two navs, the Manage Portal toggles — can import it. The DB read lives in
// `load-features.ts`.

import type { PortalFeatureFlags } from "@/lib/portal/contracts";

export const PORTAL_FEATURE_KEYS = ["investments", "budget", "documents"] as const;

export type PortalFeatureKey = (typeof PORTAL_FEATURE_KEYS)[number];

export type PortalFeatures = Record<PortalFeatureKey, boolean>;

/**
 * Compile-time parity between this module's `PortalFeatures` and the wire
 * shape `PortalMeDTO.features` carries. contracts.ts cannot import this file
 * (it is type-only for the mobile build, which has no `@/` mapping into the
 * web src), so the shape is written twice and reconciled here: adding a key to
 * PORTAL_FEATURE_KEYS without adding it to PortalFeatureFlags — or vice versa
 * — stops compiling, rather than silently shipping a switch mobile can't see.
 */
type Expect<T extends true> = T;
type Covers<A, B> = A extends B ? true : false;
// Never referenced by design — the assertion *is* the instantiation, which
// fails to compile when the two shapes diverge.
/* eslint-disable @typescript-eslint/no-unused-vars */
type _DomainCoversWire = Expect<Covers<PortalFeatures, PortalFeatureFlags>>;
type _WireCoversDomain = Expect<Covers<PortalFeatureFlags, PortalFeatures>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

/** Everything on — the pre-feature behavior, and the default for every column. */
export const DEFAULT_PORTAL_FEATURES: PortalFeatures = {
  investments: true,
  budget: true,
  documents: true,
};

export interface PortalFeatureMeta {
  key: PortalFeatureKey;
  label: string;
  /** Advisor-facing helper line on the Manage Portal → Features card. */
  description: string;
}

/** Display order on the Features card. Matches the portal rail's order. */
export const PORTAL_FEATURE_META: readonly PortalFeatureMeta[] = [
  {
    key: "investments",
    label: "Investments",
    description: "Holdings, allocation and performance for their investment accounts.",
  },
  {
    key: "budget",
    label: "Budget",
    description: "Spending plan, transactions and recurring bills — plus the dashboard tiles that read them.",
  },
  {
    key: "documents",
    label: "Documents",
    description: "The shared document vault they upload to and download from.",
  },
] as const;

/**
 * The section's name as the client and the advisor both see it — the rail
 * entry, the Features card row, the 403 message and the section-off screen all
 * read from the same string.
 */
export function portalFeatureLabel(feature: PortalFeatureKey): string {
  return PORTAL_FEATURE_META.find((f) => f.key === feature)?.label ?? feature;
}

/**
 * The three `clients` columns the switches live on. Structural rather than
 * `typeof clients.$inferSelect` so this file stays free of `@/db` — any query
 * that selects the columns under their own names satisfies it, as does a full
 * client row.
 */
export interface PortalFeatureColumns {
  portalInvestmentsEnabled: boolean;
  portalBudgetEnabled: boolean;
  portalDocumentsEnabled: boolean;
}

/**
 * Project a client row onto the feature switches — the one place feature key ↔
 * column is written on the read side, so a page that already holds the row
 * never re-spells the mapping (all three columns are boolean, so a cross-wired
 * alias would typecheck clean and gate the wrong section).
 *
 * No row → everything on, matching `loadPortalFeatures`.
 */
export function toPortalFeatures(
  row: PortalFeatureColumns | null | undefined,
): PortalFeatures {
  return row
    ? {
        investments: row.portalInvestmentsEnabled,
        budget: row.portalBudgetEnabled,
        documents: row.portalDocumentsEnabled,
      }
    : DEFAULT_PORTAL_FEATURES;
}

/** True when `value` is one of the three switchable features. */
export function isPortalFeatureKey(value: unknown): value is PortalFeatureKey {
  return (
    typeof value === "string" &&
    (PORTAL_FEATURE_KEYS as readonly string[]).includes(value)
  );
}
