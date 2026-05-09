// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../export-modal", () => ({
  ExportModal: ({
    reportId,
    open,
  }: {
    reportId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? <div role="dialog" aria-label={`export-${reportId}`} /> : null,
}));

import { ExportButton } from "../export-button";

describe("ExportButton", () => {
  it("renders an Export button", () => {
    render(<ExportButton reportId="investments" />);
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("opens the modal on click and forwards reportId", () => {
    render(<ExportButton reportId="investments" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-label", "export-investments");
  });
});
