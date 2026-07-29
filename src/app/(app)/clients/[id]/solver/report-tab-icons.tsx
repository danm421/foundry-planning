import type { ReactElement, SVGProps } from "react";

// Inline Lucide-style icons for the solver right-pane report tabs (lucide-react
// is not a dependency in this repo — see solver-tab-icons.tsx / portal-icons.tsx
// for the same pattern). Outline-only, strokeWidth 1.5, currentColor — per the
// Foundry design system.
//
// Estate and Life Insurance reuse the left-pane input-tab icons so the same
// concept reads identically on both sides of the workspace.
export { EstatePlanningIcon, LifeInsuranceIcon } from "./solver-tab-icons";

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

/** Portfolio — Lucide `chart-column` (portfolio balances over time). */
export function PortfolioIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

/** Cash Flow — Lucide `arrow-down-up` (inflows vs outflows). */
export function CashFlowIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="m3 16 4 4 4-4" />
      <path d="M7 20V4" />
      <path d="m21 8-4-4-4 4" />
      <path d="M17 4v16" />
    </svg>
  );
}

/** Tax Bracket — Lucide `percent` (effective / marginal rates). */
export function TaxBracketIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <line x1="19" x2="5" y1="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

/** Monte Carlo — Lucide `dices` (probabilistic simulation). */
export function MonteCarloIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <rect width="12" height="12" x="2" y="10" rx="2" ry="2" />
      <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" />
      <path d="M6 18h.01" />
      <path d="M10 14h.01" />
      <path d="M15 6h.01" />
      <path d="M18 9h.01" />
    </svg>
  );
}

/** Education — Lucide `graduation-cap` (education-goal dedicated funding). */
export function EducationIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
    </svg>
  );
}

/** Summaries — Lucide `file-text` (the written report deck). */
export function SummariesIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

/** Balance Sheet — Lucide `scale` (assets vs liabilities in balance). */
export function BalanceSheetIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}
