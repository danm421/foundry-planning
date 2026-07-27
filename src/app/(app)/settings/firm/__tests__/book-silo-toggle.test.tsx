// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockSetBookSiloEnabled = vi.fn();
vi.mock("../actions", () => ({
  setBookSiloEnabled: (...a: unknown[]) => mockSetBookSiloEnabled(...a),
}));

import BookSiloToggle from "../book-silo-toggle";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BookSiloToggle", () => {
  it("reflects the initial value — off (firm-wide) by default", () => {
    render(<BookSiloToggle initial={false} />);
    const toggle = screen.getByRole("switch", { name: "Silo each advisor to their own book" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Firm-wide")).toBeInTheDocument();
  });

  it("reflects an initial value of true — on (per-advisor)", () => {
    render(<BookSiloToggle initial={true} />);
    const toggle = screen.getByRole("switch", { name: "Silo each advisor to their own book" });
    expect(toggle).toBeChecked();
    expect(screen.getByText("Per-advisor")).toBeInTheDocument();
  });

  it("optimistically flips on click, calls the server action with the new value, and shows Saved on success", async () => {
    mockSetBookSiloEnabled.mockResolvedValue({ ok: true });
    render(<BookSiloToggle initial={false} />);
    const toggle = screen.getByRole("switch", { name: "Silo each advisor to their own book" });

    fireEvent.click(toggle);
    expect(toggle).toBeChecked(); // optimistic flip applied immediately

    await waitFor(() => expect(mockSetBookSiloEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(toggle).toBeChecked();
  });

  it("reverts the optimistic flip and shows the server's error message when the action fails", async () => {
    mockSetBookSiloEnabled.mockResolvedValue({ ok: false, error: "No active org" });
    render(<BookSiloToggle initial={false} />);
    const toggle = screen.getByRole("switch", { name: "Silo each advisor to their own book" });

    fireEvent.click(toggle);
    expect(toggle).toBeChecked(); // optimistic flip applied immediately

    await waitFor(() => expect(screen.getByText("No active org")).toBeInTheDocument());
    expect(toggle).not.toBeChecked(); // reverted
  });
});
