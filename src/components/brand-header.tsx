import type { ReactElement } from "react";
import BrandMarkToggle from "./brand-mark-toggle";

interface BrandHeaderProps {
  firmName?: string;
  collapsed?: boolean;
}

export default function BrandHeader({
  firmName,
  collapsed = false,
}: BrandHeaderProps): ReactElement {
  return (
    <div
      className={`flex items-center gap-3 border-b border-hair py-4 ${
        collapsed ? "justify-center px-2" : "px-[var(--pad-card)]"
      }`}
    >
      <BrandMarkToggle collapsed={collapsed} />
      <div
        data-testid="brand-text"
        className={collapsed ? "hidden" : "flex flex-col gap-1.5"}
      >
        <svg
          viewBox="0 0 320 80"
          width={120}
          height={30}
          fill="none"
          aria-hidden="true"
          suppressHydrationWarning
        >
          <text
            x="0"
            y="58"
            fontWeight={700}
            fontSize={56}
            letterSpacing="-2"
            fill="#f4f5f7"
            style={{ fontFamily: "var(--font-sans)" }}
            suppressHydrationWarning
          >
            Foundry
            <tspan dx="-2" fill="#f59e0b" suppressHydrationWarning>
              .
            </tspan>
          </text>
        </svg>
        <span
          data-testid="brand-subtitle"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 leading-none"
        >
          Planning{firmName ? ` · ${firmName}` : ""}
        </span>
      </div>
    </div>
  );
}
