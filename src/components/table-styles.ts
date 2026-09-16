/**
 * Shared class strings for the record tables on the Clients screen.
 *
 * These live in their own module, rather than being exported from whichever
 * table declared them first, because the tables sit on opposite sides of the
 * server/client boundary: `unified-clients-table.tsx` is `"use client"` and
 * `sharing/shared-with-me-table.tsx` is a Server Component.
 *
 * The reason they are shared at all: an advisor reported the Clients list as
 * inert — they clicked a client's name, nothing happened, and they concluded
 * nothing on the screen was clickable. Two tables render a client's name on
 * that screen, and a fix applied to only one of them recreates the
 * inconsistency it was meant to remove.
 */

/** The base treatment for a record name in a table cell. */
export const RECORD_NAME_TEXT = "block truncate text-sm font-medium text-ink";

/**
 * A record name that navigates.
 *
 * The underline is a STANDING affordance, not a hover-only one — `hover:`
 * alone is what left advisors with nothing to see until the pointer was
 * already on the target.
 *
 * Solid, deliberately: this app already spends the DOTTED underline on
 * edit-in-place cells (`forms/inline-year-cell.tsx`, `scenario/year-table.tsx`).
 * Solid means "this navigates", dotted means "this edits here".
 *
 * `decoration-ink-3`, not `hair-3` or `ink-4`. Both of those clear 3:1 on the
 * dark and light cards but fall to 2.95:1 and 2.79:1 under the INDUSTRIAL
 * theme, where the underline stops reading as one. `ink-3` holds 8.21:1 dark ·
 * 5.99:1 light · 4.70:1 industrial — measured per theme, through a real page
 * load, by `scripts/browser-clients-affordance.local.mjs`.
 */
export const RECORD_NAME_LINK =
  `${RECORD_NAME_TEXT} underline decoration-ink-3 underline-offset-[3px] ` +
  "transition-colors hover:text-accent hover:decoration-accent " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/**
 * Row hover for a table whose rows contain controls.
 *
 * `card-hover`, never `card-2`: a row must not hover to the same fill its own
 * controls sit on, or it erases them at the one moment someone is hunting for
 * something to click.
 *
 * Still live for Shared-with-me, whose sharer and permission badges are both
 * filled `card-2`. The clients list no longer collides that way — its quick
 * links became opaque `hair-3` / `accent` buttons — but the rule holds for
 * both tables, because `card-2` is what every quiet filled control on this
 * screen reaches for by default.
 */
export const ROW_HOVER = "hover:bg-card-hover";
