"use client";

import Link from "next/link";
import { postHouseholdOpen } from "@/lib/crm/record-open";

interface ClientRowActionsProps {
  householdId: string;
  /** The linked planning client, or null when no plan exists yet. */
  planningClientId: string | null;
}

/**
 * These are BUTTONS, and the thing that makes them read as buttons is an
 * OPAQUE FILL — not a border.
 *
 * Two earlier passes tried to carry the affordance on the border alone:
 * `border-transparent` (advisors: "nothing on this screen looks clickable"),
 * then a `hair-2` hairline over `card-2`, which measured 1.73:1 dark · 1.42:1
 * light · 1.77:1 industrial and still read as text. The reason a third
 * hairline would not have worked either: every non-accent fill token in the
 * palette, measured against the card it sits on, is
 *
 *     card-2 1.06 · card-active 1.27 · hair 1.34 · hair-2 1.73 · hair-3 2.30
 *
 * (dark theme; light and industrial track the same order). Grey simply tops
 * out around 2.3:1. `accent` is the only token with real presence — 5.39:1
 * dark · 4.73:1 light · 11.28:1 industrial — which is why the primary action
 * carries it at rest rather than only on hover.
 *
 * THIS DELIBERATELY DOES NOT USE `.btn-ghost`. That is the app's canonical
 * secondary button and the design system calls it "hairline border, ink text"
 * — but it is `background: transparent` over a `hair-2` border, which IS the
 * 1.73:1 treatment measured above and rejected twice. Re-canonising these to
 * `.btn-ghost` reintroduces the reported defect. The real fix is to give
 * `.btn-ghost` itself an opaque fill in `globals.css`, which is a brand
 * re-vendor job (it also moves `crm-household-link.tsx` and
 * `IntegrationHouseholdLinkTable.tsx`, both of which still render this exact
 * "CRM" affordance the old way) and is filed rather than done here.
 *
 * No border: at every state the two skins would paint it the same token as
 * their own fill, so it drew nothing and cost 2px of width. The FILL is the
 * affordance now.
 *
 * Shared geometry, so the two skins stay the same box. The quick-link column
 * is budgeted, and `unified-clients-table.tsx`'s colgroup comment owns that
 * arithmetic: growing the padding or the type means re-measuring there.
 */
const base =
  "inline-flex h-7 items-center rounded-md px-3 text-[13px] font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/**
 * CRM — a filled grey button. Quieter than the primary, but still a solid
 * object rather than an outline. `ink` on `hair-3` holds 7.14:1 dark · 8.24:1
 * light · 4.80:1 industrial, so the label clears AA in every theme.
 */
const secondaryPill =
  `${base} bg-hair-3 text-ink hover:bg-accent hover:text-accent-on`;

/**
 * Planning — the row's primary action, in the app's own primary-button
 * vocabulary (`bg-accent` / `text-accent-on` / `hover:bg-accent-ink`, as the
 * page's "New household" CTA and the Solver's action bar already use).
 *
 * The brand reserves verdigris for action, and opening the plan is the verb
 * this screen exists for. `accent-on` on `accent` measures 5.70:1 dark ·
 * 4.79:1 light · 12.86:1 industrial — AA in all three.
 *
 * A verdigris LABEL is deliberately not used anywhere here: accent text on any
 * tinted fill measures 4.35:1 dark and 4.16:1 light, under the 4.5 floor in
 * two of the three themes.
 */
const primaryPill = `${base} bg-accent text-accent-on hover:bg-accent-ink`;

/**
 * One-click navigation pills for a household row — bridges the two detail
 * areas without the old name-anchored popover. "CRM" always opens CRM detail;
 * "Planning" opens the existing plan, or deep-links into the quick-create
 * wizard with the household pre-selected when no plan exists yet.
 *
 * They also NAME the destination, which the row's name link cannot: the name
 * opens whichever record is deepest, these say where each side lives.
 *
 * Only the Planning side is styled as the primary. A household row has one
 * verb this screen exists for — open the plan, or start one — and CRM detail
 * is the secondary errand.
 */
export function ClientRowActions({
  householdId,
  planningClientId,
}: ClientRowActionsProps) {
  const recordOpen = () => postHouseholdOpen(householdId);

  return (
    <div className="flex gap-1.5">
      <Link
        href={`/crm/households/${householdId}`}
        className={secondaryPill}
        onClick={recordOpen}
      >
        CRM
      </Link>
      {planningClientId ? (
        <Link
          href={`/clients/${planningClientId}/details`}
          className={primaryPill}
          onClick={recordOpen}
        >
          Planning
        </Link>
      ) : (
        <Link
          href={`/clients/new?crmHouseholdId=${householdId}`}
          className={primaryPill}
          onClick={recordOpen}
        >
          Start planning
        </Link>
      )}
    </div>
  );
}
