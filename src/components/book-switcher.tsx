"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { selectBaseClassName } from "@/components/forms/input-styles";

type Advisor = { userId: string; displayName: string };

/**
 * Admin-only "viewing as" dropdown for the clients list. Self-contained, like
 * the sibling `CrmHouseholdSearch` filters: reads the current `?advisor=`
 * value straight from the URL and writes changes back via `router.replace`,
 * so ClientsContent (an async server component) never has to hold state or
 * pass an onChange closure across the server/client boundary. Selecting an
 * advisor re-runs the server-rendered list query with `?advisor=<userId>`;
 * selecting "All clients" removes the param entirely.
 *
 * Not rendered at all for non-admins — gated at the call site in
 * clients-content.tsx (`{canManage && <BookSwitcher />}`). The
 * `/api/advisors` fetch below is itself admin/owner-gated server-side
 * (403 for anyone else), so a non-200 response just yields an empty list.
 */
export function BookSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [advisors, setAdvisors] = useState<Advisor[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/advisors")
      .then((r) => (r.ok ? r.json() : { advisors: [] }))
      .then((d) => alive && setAdvisors(d.advisors ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // "all" is the book-switcher's own sentinel for "no narrowing" — mirrored
  // server-side by `ALL_BOOKS` in src/lib/visibility.ts (not imported here:
  // that module pulls in @/db, which must never reach this client bundle).
  const value = searchParams.get("advisor") ?? "all";

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("advisor");
    else params.set("advisor", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-3">Viewing</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectBaseClassName} w-48`}
        aria-label="Viewing advisor's book"
      >
        <option value="all">All clients</option>
        {advisors.map((a) => (
          <option key={a.userId} value={a.userId}>
            {a.displayName}&apos;s book
          </option>
        ))}
      </select>
    </label>
  );
}
