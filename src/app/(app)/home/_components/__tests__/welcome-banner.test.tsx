// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WelcomeBanner } from "../welcome-banner";

describe("WelcomeBanner", () => {
  it("makes New household the one primary action", () => {
    render(<WelcomeBanner firstName="Dan" />);
    expect(screen.getByRole("link", { name: "+ New household" }).className).toContain("btn-primary");
    expect(screen.getByRole("link", { name: "+ New task" }).className).toContain("btn-ghost");
    expect(screen.getByRole("link", { name: "Send intake" }).className).toContain("btn-ghost");
  });

  it("ends the greeting with the accent dot", () => {
    const { container } = render(<WelcomeBanner firstName="Dan" />);
    const dot = container.querySelector(".dot")!;
    expect(dot).toBeTruthy();
    expect(dot.textContent).toBe(".");
    expect(container.querySelector("h1")!.textContent).toContain("Dan");
  });

  it("still greets when there is no first name", () => {
    const { container } = render(<WelcomeBanner firstName={null} />);
    expect(container.querySelector("h1")!.textContent).toMatch(/^Good (morning|afternoon|evening)\.$/);
  });
});
