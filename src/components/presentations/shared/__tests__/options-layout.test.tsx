// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { OptionsRow, OptionsGroup } from "../options-layout";

describe("options-layout", () => {
  it("renders a labeled group with its children", () => {
    render(
      <OptionsRow>
        <OptionsGroup label="As of">
          <span>child</span>
        </OptionsGroup>
      </OptionsRow>,
    );
    expect(screen.getByText("As of")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("lays groups out in a horizontal flex row", () => {
    const { container } = render(
      <OptionsRow>
        <OptionsGroup>
          <span>a</span>
        </OptionsGroup>
      </OptionsRow>,
    );
    expect(container.firstElementChild?.className).toContain("flex");
    expect(container.firstElementChild?.className).toContain("flex-wrap");
  });
});
