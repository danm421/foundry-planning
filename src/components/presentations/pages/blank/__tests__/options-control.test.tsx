// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BlankOptionsControl } from "../options-control";

describe("BlankOptionsControl", () => {
  it("shows 'Empty page' summary and opens the editor dialog", () => {
    render(<BlankOptionsControl value={{ markdown: "" }} onChange={() => {}} />);
    expect(screen.getByText("Empty page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit content…" }));
    expect(screen.getByRole("dialog", { name: "Edit page content" })).toBeInTheDocument();
  });

  it("summarizes the first content line", () => {
    render(<BlankOptionsControl value={{ markdown: "# Welcome\n\nbody" }} onChange={() => {}} />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });
});
