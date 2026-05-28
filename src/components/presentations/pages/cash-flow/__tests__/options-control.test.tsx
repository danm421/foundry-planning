// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CashFlowOptionsControl } from "../options-control";

describe("CashFlowOptionsControl", () => {
  it("renders three range options and reflects the current value", () => {
    const onChange = vi.fn();
    render(
      <CashFlowOptionsControl
        value={{ range: "retirement", showCallout: true }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("Retirement only")).toBeChecked();
    expect(screen.getByLabelText("Lifetime")).not.toBeChecked();
    expect(screen.getByLabelText("Custom range")).not.toBeChecked();
  });

  it("calls onChange with lifetime when Lifetime is selected", () => {
    const onChange = vi.fn();
    render(
      <CashFlowOptionsControl
        value={{ range: "retirement", showCallout: true }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Lifetime"));
    expect(onChange).toHaveBeenCalledWith({ range: "lifetime", showCallout: true });
  });

  it("shows year inputs when Custom range is selected and emits updates", () => {
    const onChange = vi.fn();
    render(
      <CashFlowOptionsControl
        value={{ range: { startYear: 2030, endYear: 2050 }, showCallout: true }}
        onChange={onChange}
      />,
    );
    const start = screen.getByLabelText("Start year") as HTMLInputElement;
    const end = screen.getByLabelText("End year") as HTMLInputElement;
    expect(start.value).toBe("2030");
    expect(end.value).toBe("2050");
    fireEvent.change(end, { target: { value: "2060" } });
    expect(onChange).toHaveBeenCalledWith({
      range: { startYear: 2030, endYear: 2060 },
      showCallout: true,
    });
  });
});
