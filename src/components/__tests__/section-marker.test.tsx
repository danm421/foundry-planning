// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SectionMarker from "../section-marker";

describe("SectionMarker", () => {
  it("renders §.NN followed by · LABEL", () => {
    const { container } = render(<SectionMarker num="01" label="Net worth" />);
    expect(container.textContent).toBe("§.01 · NET WORTH");
  });

  it("places the §.NN number in an element with accent color class", () => {
    const { container } = render(<SectionMarker num="01" label="Net worth" />);
    const accentEl = container.querySelector(".text-accent");
    expect(accentEl).not.toBeNull();
    expect(accentEl?.textContent).toBe("§.01");
  });

  it("places the label in an element with ink-4 class", () => {
    const { container } = render(<SectionMarker num="01" label="Net worth" />);
    const labelEl = container.querySelector(".text-ink-4");
    expect(labelEl).not.toBeNull();
    expect(labelEl?.textContent).toContain("NET WORTH");
  });

  it("applies font-mono and uppercase styling at the root", () => {
    const { container } = render(<SectionMarker num="01" label="Net worth" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("font-mono");
    expect(root.className).toContain("uppercase");
  });

  it("passes num through verbatim (preserves leading zero)", () => {
    const { container } = render(<SectionMarker num="07" label="Alerts" />);
    expect(container.textContent).toBe("§.07 · ALERTS");
  });
});
