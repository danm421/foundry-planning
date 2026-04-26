import type { ReactElement } from "react";
import { FoundryMark } from "./icons";

interface BrandHeaderProps {
  firmName?: string;
  collapsed?: boolean;
}

export default function BrandHeader({
  firmName,
  collapsed = false,
}: BrandHeaderProps): ReactElement {
  return (
    <div className="flex items-center gap-3 px-[var(--pad-card)] py-4 border-b border-hair">
      <FoundryMark />
      <div
        data-testid="brand-text"
        className={collapsed ? "hidden" : "flex flex-col"}
      >
        <span className="text-[14px] font-semibold text-ink leading-none">
          Foundry
        </span>
        <span
          data-testid="brand-subtitle"
          className="text-xs text-ink-3 leading-none mt-1"
        >
          Planning{firmName ? ` · ${firmName}` : ""}
        </span>
      </div>
    </div>
  );
}
