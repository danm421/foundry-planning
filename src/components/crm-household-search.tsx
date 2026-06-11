"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

export function CrmHouseholdSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function updateParam(key: string, value: string, debounce: boolean) {
    const apply = () => {
      const params = new URLSearchParams(searchParams);
      if (value.trim()) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };
    if (debounce) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(apply, 250);
    } else {
      apply();
    }
  }

  const view = searchParams.get("view") === "all" ? "all" : "recent";
  const segBase =
    "inline-flex h-10 items-center rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors";
  const segActive = "bg-accent text-accent-on";
  const segIdle = "text-ink-2 hover:bg-card-hover";

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div
        role="group"
        aria-label="Filter clients"
        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-1"
      >
        <button
          type="button"
          aria-pressed={view === "recent"}
          onClick={() => updateParam("view", "", false)}
          className={`${segBase} ${view === "recent" ? segActive : segIdle}`}
        >
          Recently opened
        </button>
        <button
          type="button"
          aria-pressed={view === "all"}
          onClick={() => updateParam("view", "all", false)}
          className={`${segBase} ${view === "all" ? segActive : segIdle}`}
        >
          All clients
        </button>
      </div>
      <input
        type="search"
        placeholder="Search households by name"
        defaultValue={searchParams.get("search") ?? ""}
        onChange={(e) => updateParam("search", e.target.value, true)}
        className={`${inputClassName} sm:max-w-md`}
        aria-label="Search households"
      />
      <select
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => updateParam("status", e.target.value, false)}
        className={`${selectClassName} sm:w-48`}
        aria-label="Filter by status"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
