import type { ReactElement } from "react";

export function CategoryPill({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}): ReactElement {
  if (!name) {
    return <span className="block truncate text-[12px] text-ink-3">Uncategorized</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "var(--data-grey)" }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
