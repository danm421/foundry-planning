// src/components/fact-finder/icons.tsx
// Lucide outlines drawn inline (the repo has no icon package), at strokeWidth 1.5.
import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Outline({ className = "h-4 w-4", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Lucide `circle-alert`. */
export function AlertIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Outline>
  );
}

/** Lucide `link-2`. */
export function LinkIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </Outline>
  );
}

/** Lucide `x`. */
export function CloseIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Outline>
  );
}

/** Lucide `panel-right`. */
export function PanelIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </Outline>
  );
}

/** Lucide `plus`. */
export function PlusIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Outline>
  );
}

/** Lucide `trash-2`. */
export function TrashIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Outline>
  );
}
