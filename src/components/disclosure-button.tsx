import { ChevronRightIcon } from "@/components/icons";

/**
 * Full-width header of a collapsible box: a chevron that turns down when open,
 * then the caller's label and figures on one baseline.
 */
export function DisclosureButton({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-card-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hair-2"
    >
      <ChevronRightIcon
        width={12}
        height={12}
        strokeWidth={1.5}
        aria-hidden="true"
        className={
          "shrink-0 self-center text-ink-4 motion-safe:transition-transform " +
          (open ? "rotate-90" : "")
        }
      />
      {children}
    </button>
  );
}
