// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrencyInput } from "@/components/portal/currency-input";

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <CurrencyInput aria-label="Amount" value={v} onValueChange={setV} />;
}

it("shows the value comma-grouped while idle", () => {
  render(<Harness initial="2700" />);
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("2,700");
});

it("shows raw digits while focused, regroups on blur", () => {
  render(<Harness initial="2700" />);
  const input = screen.getByLabelText("Amount") as HTMLInputElement;
  fireEvent.focus(input);
  expect(input.value).toBe("2700");
  fireEvent.change(input, { target: { value: "15000" } });
  expect(input.value).toBe("15000"); // no commas mid-type
  fireEvent.blur(input);
  expect(input.value).toBe("15,000");
});

it("reports the raw (comma-free) string to the parent", () => {
  const onValueChange = vi.fn();
  render(<CurrencyInput aria-label="Amount" value="" onValueChange={onValueChange} />);
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "4200" } });
  expect(onValueChange).toHaveBeenCalledWith("4200");
});

it("keeps empty input empty and preserves a half-typed decimal while focused", () => {
  render(<Harness initial="" />);
  const input = screen.getByLabelText("Amount") as HTMLInputElement;
  expect(input.value).toBe("");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "2700." } });
  expect(input.value).toBe("2700."); // caret-safe: not regrouped mid-type
});
