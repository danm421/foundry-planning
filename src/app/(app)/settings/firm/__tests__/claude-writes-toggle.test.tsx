// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockSetClaudeWritesEnabled = vi.fn();
vi.mock("../actions", () => ({
  setClaudeWritesEnabled: (...a: unknown[]) => mockSetClaudeWritesEnabled(...a),
}));

import ClaudeWritesToggle from "../claude-writes-toggle";

const NAME = "Let Claude make changes";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClaudeWritesToggle", () => {
  it("is off by default and says read-only", () => {
    render(<ClaudeWritesToggle initial={false} />);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });

  it("flips on optimistically, saves, and says Saved", async () => {
    mockSetClaudeWritesEnabled.mockResolvedValue({ ok: true });
    render(<ClaudeWritesToggle initial={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    await waitFor(() => expect(mockSetClaudeWritesEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Can save")).toBeInTheDocument();
  });

  it("reverts and shows the server's error when saving fails", async () => {
    mockSetClaudeWritesEnabled.mockResolvedValue({ ok: false, error: "No active org" });
    render(<ClaudeWritesToggle initial={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("No active org")).toBeInTheDocument());
    expect(toggle).not.toBeChecked();
  });
});
