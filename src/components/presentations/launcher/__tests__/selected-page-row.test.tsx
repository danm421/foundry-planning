// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectedPageRow } from "../selected-page-row";

const baseProps = {
  index: 0,
  pageId: "cashFlow" as const,
  options: { range: "full", showCallout: true },
  scenarioOverride: undefined as string | null | undefined,
  onOptionsChange: vi.fn(),
  onScenarioOverrideChange: vi.fn(),
  onRemove: vi.fn(),
  onPreview: vi.fn(),
  onDownload: vi.fn(),
  scenarios: [],
  snapshots: [],
};

describe("SelectedPageRow", () => {
  it("shows the page title and summary chip", () => {
    render(<SelectedPageRow {...baseProps} />);
    expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    expect(screen.getByText("Full range")).toBeInTheDocument();
  });

  it("calls onRemove when remove button clicked", () => {
    const onRemove = vi.fn();
    render(<SelectedPageRow {...baseProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Cash Flow"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("expands options when disclosure is toggled and emits onOptionsChange", () => {
    const onOptionsChange = vi.fn();
    render(<SelectedPageRow {...baseProps} onOptionsChange={onOptionsChange} />);
    fireEvent.click(screen.getByText("Options"));
    fireEvent.click(screen.getByLabelText("Custom"));
    expect(onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        showCallout: true,
        range: expect.objectContaining({ startYear: expect.any(Number), endYear: expect.any(Number) }),
      }),
    );
  });
});
