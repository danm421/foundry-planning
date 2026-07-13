import { DialogShell } from "foundry-planning";
import type { ReactNode } from "react";

const noop = () => {};

/** DialogShell renders `fixed inset-0`; the transform makes this frame the
 *  containing block so the dialog lays out inside the card instead of
 *  escaping the cell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative h-[620px] w-[860px] overflow-hidden bg-paper font-sans"
      style={{ transform: "translateZ(0)" }}
    >
      {children}
    </div>
  );
}

const fieldClass =
  "h-9 w-full rounded border border-hair bg-card-2 px-3 text-[13px] text-ink outline-none";

export function Standard() {
  return (
    <Frame>
    <DialogShell
      open
      onOpenChange={noop}
      title="Add account"
      size="md"
      primaryAction={{ label: "Save account", onClick: noop }}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">
            Account name
          </label>
          <input className={fieldClass} defaultValue="Schwab brokerage" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">
            Current balance
          </label>
          <input className={`${fieldClass} tabular`} defaultValue="$1,284,500" />
        </div>
        <p className="text-[12px] text-ink-3">
          Balances refresh nightly for linked accounts.
        </p>
      </div>
    </DialogShell>
    </Frame>
  );
}

export function Tabbed() {
  return (
    <Frame>
    <DialogShell
      open
      onOpenChange={noop}
      title="Edit account"
      size="md"
      fixedHeight
      tabs={[
        { id: "details", label: "Details" },
        { id: "holdings", label: "Holdings" },
        { id: "beneficiaries", label: "Beneficiaries" },
      ]}
      activeTab="details"
      onTabChange={noop}
      primaryAction={{ label: "Save", onClick: noop }}
      destructiveAction={{ label: "Delete account", onClick: noop }}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">
            Account name
          </label>
          <input className={fieldClass} defaultValue="Vanguard 401(k) — Ellen" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-2">
            Tax treatment
          </label>
          <input className={fieldClass} defaultValue="Pre-tax (traditional)" />
        </div>
      </div>
    </DialogShell>
    </Frame>
  );
}
