"use client";

import { useEffect } from "react";

/**
 * Re-applies `location.hash` once the page it sits in has actually rendered.
 *
 * The Organizer page is an async server component under
 * `(portal)/portal/loading.tsx`, so the browser gets the skeleton first and
 * resolves `#family` / `#trusts` against a DOM that does not contain those
 * sections yet. It gives up, the sections stream in afterwards, and nothing
 * re-runs the scroll — measured at 1280x620, the anchor landed in only 11 of 24
 * cold loads (and direct navigation to `/portal/organizer#family`, with no
 * redirect involved at all, was no better). That matters because
 * `/portal/profile/family` and `/portal/profile/trusts` redirect here by
 * fragment, so an old welcome-email link otherwise lands at the top of the page.
 *
 * Rendered INSIDE the streamed content, so the effect cannot fire before the
 * target exists: the sections and this component are inserted in the same
 * commit, and effects run after it. `scrollIntoView` honours the sections'
 * `scroll-mt-*`, and walks whatever ancestor actually scrolls — on desktop the
 * portal's `<main>` is the scroller, not the document.
 */
export default function ScrollToHash(): null {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);

  return null;
}
