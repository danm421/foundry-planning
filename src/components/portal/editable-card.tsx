import type { ReactElement, ReactNode } from "react";

/**
 * A card whose whole surface is the edit affordance.
 *
 * Renders as a `<button>` when the client may edit and a plain `<div>` when they
 * may not — a read-only portal must not advertise a control that does nothing,
 * and a focusable element with no action is a keyboard dead end. Shared by the
 * Household contact cards and the Family cards so the focus-visible treatment
 * (the accessibility-relevant half) cannot drift between them; each caller still
 * owns its own `className` and body layout, which genuinely differ.
 */
export default function EditableCard({
  editEnabled,
  onEdit,
  ariaLabel,
  className,
  children,
}: {
  editEnabled: boolean;
  onEdit: () => void;
  ariaLabel: string;
  className: string;
  children: ReactNode;
}): ReactElement {
  if (!editEnabled) return <div className={className}>{children}</div>;

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={ariaLabel}
      className={`${className} group transition-colors hover:border-hair-2 focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25`}
    >
      {children}
    </button>
  );
}
