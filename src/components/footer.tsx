import type { ReactElement } from "react";
import { FoundryMark } from "./icons";

export default function Footer(): ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-hair bg-paper">
      <div className="px-[var(--pad-card)] py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <FoundryMark width={20} height={20} />
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-ink">
                Foundry<span className="text-accent">.</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                Planning
              </span>
            </div>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3"
          >
            <a
              href="https://foundryplanning.com"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ink"
            >
              foundryplanning.com
            </a>
            <a
              href="https://app.foundryplanning.com"
              className="transition-colors hover:text-ink"
            >
              app.foundryplanning.com
            </a>
            <a
              href="https://foundryplanning.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ink"
            >
              Privacy
            </a>
            <a
              href="https://foundryplanning.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ink"
            >
              Terms
            </a>
          </nav>

          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-4">
            © {year} Foundry Planning
          </div>
        </div>
      </div>
    </footer>
  );
}
