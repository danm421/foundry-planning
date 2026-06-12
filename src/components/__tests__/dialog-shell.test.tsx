// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DialogShell, { surfaceHeightStyle } from "../dialog-shell";

describe("DialogShell", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <DialogShell open={false} onOpenChange={() => {}} title="X">body</DialogShell>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title, body, and a close button when open", () => {
    render(
      <DialogShell open onOpenChange={() => {}} title="Edit Account">
        <p>body content</p>
      </DialogShell>
    );
    expect(screen.getByText("Edit Account")).toBeDefined();
    expect(screen.getByText("body content")).toBeDefined();
    expect(screen.getByLabelText("Close")).toBeDefined();
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <DialogShell open onOpenChange={onOpenChange} title="X">body</DialogShell>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape is pressed", () => {
    const onOpenChange = vi.fn();
    render(
      <DialogShell open onOpenChange={onOpenChange} title="X">body</DialogShell>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when the overlay is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <DialogShell open onOpenChange={onOpenChange} title="X">body</DialogShell>
    );
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders primaryAction button and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <DialogShell
        open
        onOpenChange={() => {}}
        title="X"
        primaryAction={{ label: "Save", onClick }}
      >
        body
      </DialogShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("disables primary button when primaryAction.disabled", () => {
    render(
      <DialogShell
        open
        onOpenChange={() => {}}
        title="X"
        primaryAction={{ label: "Save", onClick: () => {}, disabled: true }}
      >
        body
      </DialogShell>
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("shows 'Saving…' label when primaryAction.loading", () => {
    render(
      <DialogShell
        open
        onOpenChange={() => {}}
        title="X"
        primaryAction={{ label: "Save", onClick: () => {}, loading: true }}
      >
        body
      </DialogShell>
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDefined();
  });

  it("renders destructiveAction button on the left when provided", () => {
    const onClick = vi.fn();
    render(
      <DialogShell
        open
        onOpenChange={() => {}}
        title="X"
        destructiveAction={{ label: "Delete", onClick }}
      >
        body
      </DialogShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("uses brand-token classes on the surface", () => {
    render(
      <DialogShell open onOpenChange={() => {}} title="X">body</DialogShell>
    );
    const surface = screen.getByRole("dialog");
    expect(surface.className).toContain("bg-card");
    expect(surface.className).toContain("border-ink-3");
  });

  it("returns focus to the previously-focused element on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <DialogShell open title="T" onOpenChange={() => {}}>
        x
      </DialogShell>
    );
    // dialog surface takes focus while open
    expect(document.activeElement).not.toBe(trigger);

    rerender(
      <DialogShell open={false} title="T" onOpenChange={() => {}}>
        x
      </DialogShell>
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("wraps Tab from the last focusable back to the first (focus trap)", () => {
    render(
      <DialogShell
        open
        title="T"
        onOpenChange={() => {}}
        primaryAction={{ label: "Save", onClick: () => {} }}
      >
        <button>inner</button>
      </DialogShell>
    );
    const surface = screen.getByRole("dialog");
    const focusables = Array.from(
      surface.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Forward Tab from the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(surface, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first element wraps to the last.
    first.focus();
    fireEvent.keyDown(surface, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  // surfaceHeightStyle is asserted directly: jsdom's CSS parser drops the
  // `min()` function, so reading it back off an element's computed style is
  // unreliable. The mapping (prop → height) is the part that can regress.
  describe("surfaceHeightStyle", () => {
    it("hugs content with a max-height by default", () => {
      expect(surfaceHeightStyle({})).toEqual({ maxHeight: "min(80vh, 720px)" });
    });

    it("pins a fixed height (no shrinking) when fixedHeight is set", () => {
      expect(surfaceHeightStyle({ fixedHeight: true })).toEqual({
        height: "min(80vh, 720px)",
      });
    });

    it("uses the tall fill height when contentFill is set, which wins over fixedHeight", () => {
      expect(surfaceHeightStyle({ contentFill: true })).toEqual({
        height: "min(90vh, 940px)",
      });
      expect(surfaceHeightStyle({ contentFill: true, fixedHeight: true })).toEqual({
        height: "min(90vh, 940px)",
      });
    });
  });

  it("renders a tab strip when tabs is provided and switches active tab", () => {
    const onTabChange = vi.fn();
    render(
      <DialogShell
        open
        onOpenChange={() => {}}
        title="X"
        tabs={[
          { id: "details", label: "Details" },
          { id: "more", label: "More" },
        ]}
        activeTab="details"
        onTabChange={onTabChange}
      >
        body
      </DialogShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onTabChange).toHaveBeenCalledWith("more");
  });
});

// Regression: the App Router keeps <body> mounted across client navigations, so
// a leaked `overflow: hidden` rides onto the next page and locks its scroll
// until a hard refresh. This reproduces the leak path — a delete dialog opened
// from inside an edit dialog, with both closing in one batched update (exactly
// what performAccountDelete does).
describe("DialogShell body scroll lock", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  // Two sibling shells in the same tree order as balance-sheet-view: the edit
  // dialog renders before the delete dialog.
  function Stack({ editOpen, deleteOpen }: { editOpen: boolean; deleteOpen: boolean }) {
    return (
      <>
        <DialogShell open={editOpen} onOpenChange={() => {}} title="Edit Account">
          edit body
        </DialogShell>
        <DialogShell open={deleteOpen} onOpenChange={() => {}} title="Delete Account">
          delete body
        </DialogShell>
      </>
    );
  }

  it("restores body overflow after a single (unstacked) dialog closes", () => {
    const { rerender } = render(<Stack editOpen deleteOpen={false} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Stack editOpen={false} deleteOpen={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("restores body overflow when a stacked delete dialog and its parent edit dialog close in one update", () => {
    const { rerender } = render(<Stack editOpen deleteOpen={false} />);
    expect(document.body.style.overflow).toBe("hidden");

    // Delete dialog opens on top while the edit dialog is still open — the inner
    // shell captures prev="hidden" (the outer shell's lock).
    rerender(<Stack editOpen deleteOpen />);
    expect(document.body.style.overflow).toBe("hidden");

    // Both close in one batched update. The leak: the inner shell's cleanup runs
    // last and restores its stale prev="hidden", re-locking the body.
    rerender(<Stack editOpen={false} deleteOpen={false} />);
    expect(document.body.style.overflow).toBe("");
  });
});
