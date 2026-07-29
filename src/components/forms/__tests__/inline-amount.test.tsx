// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineAmount } from "../inline-amount";

describe("InlineAmount", () => {
  it("renders the formatted value as a button until clicked", () => {
    render(<InlineAmount amount={400000} onSave={vi.fn()} label="IRA" />);
    expect(screen.getByRole("button", { name: /Edit amount for IRA/ })).toHaveTextContent("$400,000");
  });

  it("commits the typed value on Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InlineAmount amount={400000} onSave={onSave} label="IRA" />);

    await user.click(screen.getByRole("button", { name: /Edit amount for IRA/ }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "500000{Enter}");

    expect(onSave).toHaveBeenCalledWith(500000);
  });

  it("cancels on Escape without saving", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InlineAmount amount={400000} onSave={onSave} label="IRA" />);

    await user.click(screen.getByRole("button", { name: /Edit amount for IRA/ }));
    await user.type(screen.getByRole("textbox"), "999{Escape}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save when the value is unchanged", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InlineAmount amount={400000} onSave={onSave} label="IRA" />);

    await user.click(screen.getByRole("button", { name: /Edit amount for IRA/ }));
    await user.type(screen.getByRole("textbox"), "{Enter}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders percent mode with a % suffix and no $ prefix", async () => {
    const user = userEvent.setup();
    render(<InlineAmount amount={6.2} onSave={vi.fn()} label="IRA growth" mode="percent" />);

    const trigger = screen.getByRole("button", { name: /Edit amount for IRA growth/ });
    expect(trigger).toHaveTextContent("6.20%");

    await user.click(trigger);
    expect(screen.queryByText("$")).not.toBeInTheDocument();
  });

  // Extraction-fidelity guards (controller resolution R12). The Task 4 brief's
  // snippet silently dropped the original's input `aria-label` and its
  // `min-w-[88px]`. Both are behavioural, not palette, so they were preserved —
  // these two cases are what keeps them from being dropped again. The `{ name }`
  // query is the point: `getByRole("textbox")` above passes with no label at all.
  it("labels the open input for screen readers", async () => {
    const user = userEvent.setup();
    render(<InlineAmount amount={400000} onSave={vi.fn()} label="IRA" />);

    await user.click(screen.getByRole("button", { name: /Edit amount for IRA/ }));
    expect(screen.getByRole("textbox", { name: "Amount for IRA" })).toBeInTheDocument();
  });

  it("keeps the trigger's minimum width by default, and drops it when the caller styles it", () => {
    const { unmount } = render(<InlineAmount amount={400000} onSave={vi.fn()} label="IRA" />);
    expect(screen.getByRole("button", { name: /Edit amount for IRA/ }).className).toContain(
      "min-w-[88px]",
    );
    unmount();

    render(<InlineAmount amount={400000} onSave={vi.fn()} label="IRA" className="text-xs" />);
    const styled = screen.getByRole("button", { name: /Edit amount for IRA/ });
    expect(styled.className).toBe("text-xs");
  });
});
