// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DialogShell from "../dialog-shell";

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
