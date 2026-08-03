"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputBaseClassName, selectBaseClassName } from "@/components/forms/input-styles";
import { BookSwitcher } from "@/components/book-switcher";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

type ViewTab = { value: string; label: string; adminOnly?: boolean };

/**
 * The list views, in tab order. Recently opened is the default and is
 * expressed as the *absence* of `?view=`, so its value is "" and its link
 * drops the param — matching how the server resolves the view.
 */
const VIEWS: ViewTab[] = [
  { value: "", label: "Recently opened" },
  { value: "all", label: "All" },
  { value: "shared", label: "Shared with me" },
  { value: "deleted", label: "Trash", adminOnly: true },
];

/**
 * The clients list's single filter section: view tabs, name search, status,
 * and — for admins — the book switcher, all on one row. Views are links so
 * the back button, middle-click, and open-in-new-tab behave; search and
 * status are `replace`d instead so typing doesn't pile up history entries.
 *
 * Self-contained by design, like its sibling `BookSwitcher`: every control
 * reads its current value straight from the URL and writes changes back, so
 * ClientsContent (an async server component) never holds state or passes an
 * onChange closure across the server/client boundary.
 */
export function ClientsFilterBar({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * The current URL with one param replaced. `take` always goes: changing the
   * result set invalidates how far the user had paged.
   */
  function hrefWith(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) params.set(key, value);
    else params.delete(key);
    params.delete("take");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function updateParam(key: string, value: string, debounce: boolean) {
    const apply = () => router.replace(hrefWith(key, value), { scroll: false });
    if (debounce) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(apply, 250);
    } else {
      apply();
    }
  }

  // Unrecognized ?view= falls back to Recently opened — the same rule the
  // server applies, so the highlighted tab can't disagree with the list.
  const raw = searchParams.get("view") ?? "";
  const view = VIEWS.some((v) => v.value !== "" && v.value === raw) ? raw : "";
  // "Shared with me" lists cross-firm grants rather than this firm's
  // households, so the name/status/book filters have nothing to act on.
  const filterable = view !== "shared";

  const tabBase =
    "inline-flex h-full items-center rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors";
  const tabActive = "bg-accent text-accent-on";
  const tabIdle = "text-ink-2 hover:bg-card-hover hover:text-ink";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <nav
        aria-label="Client views"
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-1"
      >
        {VIEWS.filter((v) => !v.adminOnly || canManage).map((v) => (
          <Link
            key={v.value || "recent"}
            href={hrefWith("view", v.value)}
            aria-current={view === v.value ? "page" : undefined}
            className={`${tabBase} ${view === v.value ? tabActive : tabIdle}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {filterable && (
        <>
          <input
            type="search"
            placeholder="Search households by name"
            defaultValue={searchParams.get("search") ?? ""}
            onChange={(e) => updateParam("search", e.target.value, true)}
            className={`${inputBaseClassName} min-w-0 flex-1 sm:max-w-md`}
            aria-label="Search households"
          />
          <select
            defaultValue={searchParams.get("status") ?? ""}
            onChange={(e) => updateParam("status", e.target.value, false)}
            className={`${selectBaseClassName} w-44 shrink-0`}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {canManage && <BookSwitcher />}
        </>
      )}
    </div>
  );
}
