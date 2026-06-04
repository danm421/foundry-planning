// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CashFlowOptionsControl } from "../options-control";

describe("CashFlowOptionsControl", () => {
  it("reflects the Full range value", () => {
    render(<CashFlowOptionsControl value={{ range: "full", showCallout: true }} onChange={vi.fn()} />);
    expect((screen.getByLabelText("Full") as HTMLInputElement).checked).toBe(true);
  });

  it("emits a custom span when Custom is selected, preserving other options", () => {
    const onChange = vi.fn();
    render(<CashFlowOptionsControl value={{ range: "full", showCallout: true }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Custom"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        showCallout: true,
        range: expect.objectContaining({ startYear: expect.any(Number), endYear: expect.any(Number) }),
      }),
    );
  });

  it("edits the end year of a custom range", () => {
    const onChange = vi.fn();
    render(
      <CashFlowOptionsControl
        value={{ range: { startYear: 2030, endYear: 2050 }, showCallout: true }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("End year"), { target: { value: "2060" } });
    expect(onChange).toHaveBeenCalledWith({ range: { startYear: 2030, endYear: 2060 }, showCallout: true });
  });
});
