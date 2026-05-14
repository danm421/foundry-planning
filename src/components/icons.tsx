import { useId } from "react";
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseSvgProps: IconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  suppressHydrationWarning: true,
};

export function HomeIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function ClientsIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function FileTextIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function ListCheckIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M16 4h4v4" />
      <path d="m9 11 3 3 8-8" />
      <path d="M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" />
    </svg>
  );
}

export function BarChartIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="m5.4 5.4 2.8 2.8" />
      <path d="m15.8 15.8 2.8 2.8" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.4 18.6 2.8-2.8" />
      <path d="m15.8 8.2 2.8-2.8" />
    </svg>
  );
}

export function FoundryMark({ width = 30, height = 30, ...props }: IconProps) {
  const reactId = useId();
  const front = `fp-front-${reactId}`;
  const deep = `fp-deep-${reactId}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1254 1254"
      fill="none"
      role="img"
      aria-label="Foundry Planning"
      suppressHydrationWarning
      {...props}
    >
      <defs>
        <linearGradient id={front} x1="384" y1="342" x2="885" y2="764" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" suppressHydrationWarning />
          <stop offset="42%" stopColor="#f59e0b" suppressHydrationWarning />
          <stop offset="100%" stopColor="#e58a00" suppressHydrationWarning />
        </linearGradient>
        <linearGradient id={deep} x1="515" y1="640" x2="621" y2="997" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f59e0b" suppressHydrationWarning />
          <stop offset="52%" stopColor="#d97706" suppressHydrationWarning />
          <stop offset="100%" stopColor="#b45309" suppressHydrationWarning />
        </linearGradient>
      </defs>
      <path d="M845 351 L393 351 L393 810 L476 888 L477 888 L477 434 L478 433 L762 433 Z" fill={`url(#${front})`} />
      <path d="M800 504 L764 496 L533 496 L533 581 L757 581 L782 588 L794 596 L804 607 L810 621 L810 638 L803 653 L791 664 L769 672 L535 673 L552 690 L551 691 L533 674 L533 931 L618 998 L618 756 L768 756 L807 749 L834 737 L855 722 L874 701 L883 687 L890 671 L896 647 L897 622 L892 596 L880 569 L864 547 L846 530 L824 515 Z" fill={`url(#${front})`} />
      <path d="M533 674 L618 756 L618 998 L533 931 Z" fill={`url(#${deep})`} opacity="0.98" />
      <path d="M393 810 L476 888 L477 433 L393 351 Z" fill={`url(#${front})`} opacity="0.96" />
      <path d="M533 674 L618 756" fill="none" stroke="#7c3f00" strokeWidth="2" strokeOpacity="0.45" suppressHydrationWarning />
      <path d="M393 351 H845 L834 362 H402 V798 L393 810 Z" fill="#fbbf24" opacity="0.22" suppressHydrationWarning />
      <path d="M533 496 H764 C793 496 820 505 846 524 C819 514 794 509 764 509 H546 V568 H533 Z" fill="#fbbf24" opacity="0.20" suppressHydrationWarning />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function ChartLineIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </svg>
  );
}

export function PieChartIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M21 12A9 9 0 1 1 12 3v9z" />
      <path d="M21 12A9 9 0 0 0 12 3v9z" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4m8-4v4" />
    </svg>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5m0 3h.01" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6" />
    </svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" />
      <path d="M18 12h.01" />
    </svg>
  );
}

export function CreditCardIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

export function FlowIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M3 7h13l-3-3m3 3-3 3" />
      <path d="M21 17H8l3 3m-3-3 3-3" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ScrollIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
    </svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function ClipboardCheckIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function CircleIcon(props: IconProps) {
  return (
    <svg {...baseSvgProps} {...props}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
