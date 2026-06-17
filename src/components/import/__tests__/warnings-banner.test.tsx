// @vitest-environment jsdom
// src/components/import/__tests__/warnings-banner.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import WarningsBanner from "../warnings-banner";

describe("WarningsBanner", () => {
  it("renders one item per warning", () => {
    const { container, getByText } = render(
      <WarningsBanner warnings={["recovered via image OCR", "first 30 of 58 pages"]} />,
    );
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(getByText(/recovered via image OCR/)).toBeTruthy();
  });

  it("renders nothing when there are no warnings", () => {
    const { container } = render(<WarningsBanner warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
