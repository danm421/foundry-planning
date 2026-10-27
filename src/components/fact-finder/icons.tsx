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

/** Lucide `loader-circle`. */
export function LoaderIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Outline>
  );
}

/** Lucide `circle-check`. */
export function CircleCheckIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Outline>
  );
}

/** Lucide `clock`. */
export function ClockIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Outline>
  );
}

/** Lucide `undo-2`. */
export function UndoIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </Outline>
  );
}

/** Lucide `sparkles`. */
export function SparklesIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </Outline>
  );
}
