// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import BrandHeader from "../brand-header";

describe("BrandHeader", () => {
  it("renders the Foundry mark and product name", () => {
    const { container } = render(<BrandHeader />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Foundry");
    expect(container.textContent).toContain("Planning");
  });

  it("includes the firmName suffix when provided", () => {
    const { container } = render(<BrandHeader firmName="Westford" />);
    expect(container.textContent).toContain("Westford");
    expect(container.textContent).toContain("·");
  });

  it("omits the separator dot when firmName is missing", () => {
    const { container } = render(<BrandHeader />);
    const subtitle = container.querySelector('[data-testid="brand-subtitle"]');
    expect(subtitle?.textContent).toBe("Planning");
  });

  it("hides the text stack when collapsed", () => {
    const { container } = render(<BrandHeader collapsed firmName="Westford" />);
    const textStack = container.querySelector('[data-testid="brand-text"]');
    expect(textStack?.className).toContain("hidden");
  });
});
