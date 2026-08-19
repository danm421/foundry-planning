// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TidbitPicker } from "../tidbit-picker";
import { TIDBITS } from "@/lib/presentations/tidbits";

const [a, b, c] = TIDBITS;

describe("TidbitPicker", () => {
  it("checks a box and reports the new selection", () => {
    const onChange = vi.fn();
    render(<TidbitPicker value={[]} onChange={onChange} max={2} />);
    fireEvent.click(screen.getByLabelText(a.title));
    expect(onChange).toHaveBeenCalledWith([a.id]);
  });

  it("refuses a third pick instead of evicting the oldest", () => {
    const onChange = vi.fn();
    render(<TidbitPicker value={[a.id, b.id]} onChange={onChange} max={2} />);
    fireEvent.click(screen.getByLabelText(c.title));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables unchecked boxes once the cap is reached", () => {
    render(<TidbitPicker value={[a.id, b.id]} onChange={() => {}} max={2} />);
    expect((screen.getByLabelText(c.title) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(a.title) as HTMLInputElement).disabled).toBe(false);
  });

  it("always allows deselecting, even at the cap", () => {
    const onChange = vi.fn();
    render(<TidbitPicker value={[a.id, b.id]} onChange={onChange} max={2} />);
    fireEvent.click(screen.getByLabelText(a.title));
    expect(onChange).toHaveBeenCalledWith([b.id]);
  });
});
