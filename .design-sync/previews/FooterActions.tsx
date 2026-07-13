import { FooterActions } from "foundry-planning";

export function Default() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="flex items-center gap-5 text-[12px] text-ink-3">
        <FooterActions />
      </div>
    </div>
  );
}

export function InFooterContext() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <footer className="border-t border-hair bg-paper" style={{ width: 620 }}>
        <div className="px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-ink">
                Foundry<span className="text-accent">.</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                Planning
              </span>
            </div>
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3"
            >
              <span className="transition-colors hover:text-ink">
                foundryplanning.com
              </span>
              <span className="transition-colors hover:text-ink">Privacy</span>
              <span className="transition-colors hover:text-ink">Terms</span>
              <FooterActions />
            </nav>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-4">
              © 2026 Foundry Planning
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
