/** Pieces the Monthly report's two views and its mode switch all use. */

export const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function BasisButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent ${
        active
          ? "border-accent font-medium text-accent"
          : "border-transparent text-ink-3 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

