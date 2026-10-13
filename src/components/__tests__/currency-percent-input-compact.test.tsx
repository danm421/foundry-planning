// @vitest-environment jsdom
// src/components/__tests__/currency-percent-input-compact.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";

const classesOf = (label: string) => screen.getByLabelText(label).className.split(/\s+/);

describe("CurrencyInput and PercentInput sizes", () => {
  it("keep their form-field size by default", () => {
    render(
      <>
        <CurrencyInput aria-label="Amount" defaultValue="1200" />
        <PercentInput aria-label="Rate" defaultValue="6.5" />
      </>,
    );
    expect(classesOf("Amount")).toEqual(expect.arrayContaining(["h-9", "px-3", "pl-7"]));
    expect(classesOf("Rate")).toEqual(expect.arrayContaining(["h-9", "px-3", "pr-7"]));
    expect(screen.getByText("$")).toHaveClass("left-3");
    expect(screen.getByText("%")).toHaveClass("right-3");
  });

  it("are one step shorter, for a table cell, when compact", () => {
    render(
      <>
        <CurrencyInput aria-label="Amount" defaultValue="1200" compact />
        <PercentInput aria-label="Rate" defaultValue="6.5" compact />
      </>,
    );
    expect(classesOf("Amount")).toEqual(expect.arrayContaining(["h-8", "px-2", "pl-6"]));
    expect(classesOf("Amount")).not.toContain("h-9");
    expect(classesOf("Rate")).toEqual(expect.arrayContaining(["h-8", "px-2", "pr-6"]));
    expect(screen.getByText("$")).toHaveClass("left-2");
    expect(screen.getByText("%")).toHaveClass("right-2");
    expect(screen.getByLabelText("Amount")).toHaveValue("1,200");
  });
});
