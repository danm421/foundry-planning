import type { ReactElement } from "react";

export function CategoryBadge({
  name,
  color,
  icon,
}: {
  name: string | null;
  color: string | null;
  icon: string | null;
}): ReactElement | null {
  if (!name) return null;
  const c = color ?? "var(--data-grey)";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
    >
      {icon && <span aria-hidden>{icon}</span>}
      <span className="max-w-[10rem] truncate">{name}</span>
    </span>
  );
}
