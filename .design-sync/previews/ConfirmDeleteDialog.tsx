import { ConfirmDeleteDialog } from "foundry-planning";
import type { ReactNode } from "react";

const noop = () => {};

/** ConfirmDeleteDialog uses DialogShell (`fixed inset-0`); the translateZ frame
 *  becomes the containing block so the dialog lays out inside the cell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden bg-paper font-sans"
      style={{ height: 440, width: 820, transform: "translateZ(0)" }}
    >
      {children}
    </div>
  );
}

export function Open() {
  return (
    <Frame>
      <ConfirmDeleteDialog
        open
        title="Delete household?"
        message="This permanently removes the Whitfield household, its 3 scenarios, and every linked account. This can't be undone."
        onCancel={noop}
        onConfirm={noop}
      />
    </Frame>
  );
}
