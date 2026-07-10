import type { ReactElement, SVGProps } from "react";
import type { FileKind } from "./vault-format";

// Outline-only Lucide-style icons — strokeWidth 1.5, currentColor — matching
// portal-icons.tsx and the Foundry design system.
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

export function FolderIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function FileTextGlyph(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function ImageGlyph(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m21 15-4.586-4.586a2 2 0 0 0-2.828 0L4 20" />
    </svg>
  );
}

/** Picks the glyph for a file kind. Keeps the vault visually scannable without a
 *  per-format icon set — images, PDFs, sheets and docs are the useful buckets. */
export function FileGlyph({ kind, ...props }: { kind: FileKind } & SVGProps<SVGSVGElement>): ReactElement {
  if (kind === "image") return <ImageGlyph {...props} />;
  // PDF / sheet / doc / file all share the document glyph; color carries the rest.
  return <FileTextGlyph {...props} />;
}

export function UploadIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

export function FolderPlusIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v6" />
      <path d="M9 13h6" />
    </svg>
  );
}

export function MoreIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

export function MoveIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M8 13h6" />
      <path d="m12 11 2 2-2 2" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function SpinnerIcon({ className, ...props }: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base} aria-hidden="true" {...props} className={`animate-spin ${className ?? ""}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
