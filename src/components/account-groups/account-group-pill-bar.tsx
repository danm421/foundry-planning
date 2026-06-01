"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type CustomGroupOption = {
  id: string;
  name: string;
  color: string | null;
};

interface Props {
  clientId: string;
  customGroups: CustomGroupOption[];
  /** Current group key — "all-liquid", "taxable", "retirement", "cash", or a UUID. */
  selected: string;
}

const DEFAULTS = [
  { key: "all-liquid", label: "All Liquid" },
  { key: "taxable", label: "Taxable" },
  { key: "retirement", label: "Retirement" },
  { key: "cash", label: "Cash" },
] as const;

export default function AccountGroupPillBar({
  clientId,
  customGroups,
  selected,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectGroup(key: string) {
    const params = new URLSearchParams(searchParams);
    if (key === "all-liquid") params.delete("group");
    else params.set("group", key);
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <div
      role="group"
      aria-label="Account group"
      className="flex items-center gap-1 overflow-x-auto rounded-md border border-hair bg-card/40 p-1"
    >
      {DEFAULTS.map((g) => {
        const active = selected === g.key;
        return (
          <button
            key={g.key}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => selectGroup(g.key)}
            className={`whitespace-nowrap rounded px-3 py-1 text-xs font-medium transition-colors ${
              active ? "bg-card-2 text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {g.label}
          </button>
        );
      })}
      {customGroups.length > 0 && <span className="mx-1 h-4 w-px bg-hair-2" />}
      {customGroups.map((g) => {
        const active = selected === g.id;
        return (
          <button
            key={g.id}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => selectGroup(g.id)}
            className={`whitespace-nowrap rounded px-3 py-1 text-xs font-medium transition-colors ${
              active ? "bg-card-2 text-ink" : "text-ink-2 hover:text-ink"
            }`}
            style={!active && g.color ? { boxShadow: `inset 0 -2px 0 0 ${g.color}` } : undefined}
          >
            {g.name}
          </button>
        );
      })}
      <span className="ml-auto">
        <Link
          href={`/clients/${clientId}/details/assumptions?tab=account-groups`}
          className="whitespace-nowrap rounded px-3 py-1 text-xs text-ink-3 hover:text-ink-2"
        >
          Edit groups →
        </Link>
      </span>
    </div>
  );
}
