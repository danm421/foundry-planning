import type { ReactElement, SVGProps } from "react";

// Inline Lucide-style icons for the solver technique catalog (lucide-react is
// not a dependency in this repo — see solver-tab-icons.tsx for the same
// pattern). Outline-only, strokeWidth 1.5, currentColor — per the Foundry
// design system.
//
// Estate planning reuses the left-pane input-tab icon so the same concept reads
// identically wherever it appears (report-tab-icons.tsx re-exports it too).
export { EstatePlanningIcon } from "./solver-tab-icons";

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} satisfies SVGProps<SVGSVGElement>;

/** Roth conversion — Lucide `arrow-right-left` (dollars moving between accounts). */
export function RothConversionIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

/** Asset transaction — Lucide `banknote` (a purchase or sale). */
export function AssetTransactionIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

/** Reinvestment — Lucide `refresh-cw` (proceeds cycling back into a portfolio). */
export function ReinvestmentIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

/** Relocation — Lucide `map-pin` (a move to a new state). */
export function RelocationIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** Debt paydown — Lucide `trending-down` (a balance retired sooner). */
export function DebtPaydownIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M16 17h6v-6" />
      <path d="m22 17-8.5-8.5-5 5L2 7" />
    </svg>
  );
}
