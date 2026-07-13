import { ToastProvider, useToast } from "foundry-planning";
import { useEffect, useRef, type ReactNode } from "react";

const noop = () => {};

/** ToastProvider's toast stack is `fixed bottom-4`; the translateZ frame becomes
 *  the containing block so the stack lays out inside the cell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden bg-paper font-sans"
      style={{ height: 380, width: 820, transform: "translateZ(0)" }}
    >
      {children}
    </div>
  );
}

function AppSurface() {
  const { showToast } = useToast();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Long duration so both toasts are still on screen at capture time.
    showToast({
      message: 'Scenario "Retire at 62" archived.',
      undo: { label: "Undo", onClick: noop },
      durationMs: 600000,
    });
    showToast({
      message: "Balance sheet exported to PDF.",
      durationMs: 600000,
    });
  }, [showToast]);

  return (
    <div className="p-6 text-ink">
      <h3 className="text-[14px] font-semibold">Scenarios</h3>
      <p className="mt-1 max-w-[440px] text-[13px] text-ink-3">
        Archived scenarios drop out of the comparison deck but stay recoverable
        for 30 days.
      </p>
    </div>
  );
}

export function Toasts() {
  return (
    <Frame>
      <ToastProvider>
        <AppSurface />
      </ToastProvider>
    </Frame>
  );
}
