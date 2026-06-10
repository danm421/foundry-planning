// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TosPage from "../tos/page";

describe("ToS §5 reflects AD-3 proration behavior", () => {
  it("states that upgrading cadence prorates immediately", () => {
    const { container } = render(<TosPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/prorat/i);
    expect(text).toMatch(/upgrad/i);
    expect(text).toMatch(/end of the current billing period/i);
  });
});
