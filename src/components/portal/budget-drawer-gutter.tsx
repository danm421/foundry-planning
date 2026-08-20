import type { ReactElement, ReactNode } from "react";

/**
 * Holds the Budget tabs' content clear of the drill-down drawer.
 *
 * The portal's `#portal-detail` drawer is a 480px overlay pinned to the right
 * edge (see the asides in the portal layout and the advisor preview page), so
 * on every other section it slides OVER the page. The Budget tabs read side by
 * side with that panel — Budget keeps a category selected by default — so here
 * the drawer gets a lane of its own instead: a 480px column the content stops
 * short of, reserved whether or not a panel is open. Opening one therefore
 * shifts nothing, and its left border lands exactly on this column's hairline.
 *
 * Shared by both hosts (client portal layout + advisor preview) so the width
 * can't be changed on one and missed on the other. Gated to `lg` to match the
 * client layout's drawer, which below that breakpoint is a bottom sheet in
 * flow rather than a right-edge overlay.
 */
export default function BudgetDrawerGutter({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="min-w-0">{children}</div>
      <div aria-hidden className="hidden lg:block lg:border-l lg:border-hair" />
    </div>
  );
}
