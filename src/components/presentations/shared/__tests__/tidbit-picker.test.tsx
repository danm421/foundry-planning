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

  it("names the cap it is actually enforcing", () => {
    render(<TidbitPicker value={[]} onChange={() => {}} max={6} />);
    expect(screen.getByText(/Pick up to 6/)).toBeTruthy();
  });

  // The default line says the picks "render beside the chart on this page",
  // which is false on the back page where the tidbits ARE the page. A sheet's
  // furniture is a claim too, and so is a picker's.
  it("lets a page that has no chart replace the hint", () => {
    render(
      <TidbitPicker
        value={[]}
        onChange={() => {}}
        max={6}
        hint="they fill this page, two to a row."
      />,
    );
    // The caller supplies only the tail, so the CAP still comes from `max` and
    // cannot drift from the one the picker actually enforces.
    expect(screen.getByText(/Pick up to 6 — they fill this page/)).toBeTruthy();
    expect(screen.queryByText(/beside the chart/)).toBeNull();
  });

  describe("Reset to default", () => {
    it("puts the page's own defaults back, in their order", () => {
      const onChange = vi.fn();
      render(
        <TidbitPicker value={[c.id]} onChange={onChange} max={2} defaults={[a.id, b.id]} />,
      );
      fireEvent.click(screen.getByText("Reset to default"));
      expect(onChange).toHaveBeenCalledWith([a.id, b.id]);
    });

    // A picker with nothing behind the button would "reset" to empty, which is
    // a clear, not a reset.
    it("is not offered when the caller names no default", () => {
      render(<TidbitPicker value={[a.id]} onChange={() => {}} max={2} />);
      expect(screen.queryByText("Reset to default")).toBeNull();
    });

    it("is inert once the selection already IS the default", () => {
      const onChange = vi.fn();
      render(
        <TidbitPicker value={[a.id, b.id]} onChange={onChange} max={2} defaults={[a.id, b.id]} />,
      );
      const button = screen.getByText("Reset to default") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(onChange).not.toHaveBeenCalled();
    });

    // The sidebar prints the cards in stored order, so a pair re-picked the
    // other way round is a DIFFERENT page and the reset still has work to do.
    it("stays live when the same two are picked in the other order", () => {
      render(
        <TidbitPicker value={[b.id, a.id]} onChange={() => {}} max={2} defaults={[a.id, b.id]} />,
      );
      expect((screen.getByText("Reset to default") as HTMLButtonElement).disabled).toBe(false);
    });

    // The button hands back a COPY: the array it is given is a module-level
    // const shared by every advisor's options dialog on the page.
    it("does not hand out the defaults array itself", () => {
      const onChange = vi.fn();
      const defaults = [a.id, b.id];
      render(<TidbitPicker value={[]} onChange={onChange} max={2} defaults={defaults} />);
      fireEvent.click(screen.getByText("Reset to default"));
      expect(onChange.mock.calls[0][0]).not.toBe(defaults);
    });
  });

  it("always allows deselecting, even at the cap", () => {
    const onChange = vi.fn();
    render(<TidbitPicker value={[a.id, b.id]} onChange={onChange} max={2} />);
    fireEvent.click(screen.getByLabelText(a.title));
    expect(onChange).toHaveBeenCalledWith([b.id]);
  });
});
