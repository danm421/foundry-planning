// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { SaveStatus } from "../save-status";

describe("SaveStatus", () => {
  it("button is disabled and pill says 'Saved' when clean and not saving", () => {
    render(<SaveStatus dirty={false} saving={false} error={null} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
  });

  it("button is enabled and pill says 'Unsaved changes' when dirty", () => {
    render(<SaveStatus dirty={true} saving={false} error={null} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it("button is disabled and pill says 'Saving…' while saving", () => {
    render(<SaveStatus dirty={true} saving={true} error={null} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  it("shows error pill and onSave fires on retry click", () => {
    const onSave = vi.fn();
    render(<SaveStatus dirty={true} saving={false} error="boom" onSave={onSave} />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalled();
  });

  it("onSave fires on click when dirty", () => {
    const onSave = vi.fn();
    render(<SaveStatus dirty={true} saving={false} error={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalled();
  });

  it("Cmd/Ctrl+S triggers onSave when dirty", () => {
    const onSave = vi.fn();
    render(<SaveStatus dirty={true} saving={false} error={null} onSave={onSave} />);
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Cmd/Ctrl+S is a no-op when not dirty", () => {
    const onSave = vi.fn();
    render(<SaveStatus dirty={false} saving={false} error={null} onSave={onSave} />);
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });
});
