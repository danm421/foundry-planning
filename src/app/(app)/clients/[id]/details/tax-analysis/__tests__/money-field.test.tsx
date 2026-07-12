// src/app/(app)/clients/[id]/details/tax-analysis/__tests__/money-field.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoneyField, parseMoneyInput } from "../money-field";

describe("parseMoneyInput", () => {
  it.each([
    ["124624", 124624],
    ["$124,624", 124624],
    ["-6141", -6141],
    ["(6,141)", -6141],
    ["$1,234.56", 1234.56],
    [" 12.5 ", 12.5],
  ])("parses %s → %s", (raw, expected) => {
    expect(parseMoneyInput(raw)).toBe(expected);
  });

  it.each([[""], [" "], ["-"], ["abc"], ["$"]])("returns null for %j", (raw) => {
    expect(parseMoneyInput(raw)).toBeNull();
  });
});

function Harness({ initial }: { initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <label>
      Amount
      <MoneyField value={v} onChange={setV} />
      <span data-testid="model">{v === null ? "null" : String(v)}</span>
    </label>
  );
}

describe("MoneyField", () => {
  it("shows the formatted value when blurred, including negatives", () => {
    render(<Harness initial={-6141} />);
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("-$6,141");
  });

  it("switches to the raw number on focus", async () => {
    const user = userEvent.setup();
    render(<Harness initial={124624} />);
    const input = screen.getByLabelText(/amount/i) as HTMLInputElement;
    await user.click(input);
    expect(input.value).toBe("124624");
  });

  it("parses edits (commas tolerated) into the model and reformats on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={null} />);
    const input = screen.getByLabelText(/amount/i) as HTMLInputElement;
    await user.click(input);
    await user.type(input, "1,234");
    expect(screen.getByTestId("model").textContent).toBe("1234");
    await user.tab();
    expect(input.value).toBe("$1,234");
  });

  it("clearing the input nulls the model and blurs to empty", async () => {
    const user = userEvent.setup();
    render(<Harness initial={500} />);
    const input = screen.getByLabelText(/amount/i) as HTMLInputElement;
    await user.clear(input);
    expect(screen.getByTestId("model").textContent).toBe("null");
    await user.tab();
    expect(input.value).toBe("");
  });

  it("is a text input with decimal inputMode (no spinner arrows)", () => {
    render(<Harness initial={1} />);
    const input = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("decimal");
  });
});
