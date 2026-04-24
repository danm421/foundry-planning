// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Card, CardHeader, CardBody, CardFooter } from "../card";

describe("Card", () => {
  it("renders a section with card background, hair border, and rounded corners", () => {
    const { container } = render(<Card>content</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe("SECTION");
    expect(el.className).toContain("bg-card");
    expect(el.className).toContain("border-hair");
    expect(el.className).toContain("rounded");
  });

  it("passes through className", () => {
    const { container } = render(<Card className="col-span-2">x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain("col-span-2");
  });

  it("renders children", () => {
    const { getByText } = render(<Card>hello</Card>);
    expect(getByText("hello")).toBeDefined();
  });
});

describe("CardHeader", () => {
  it("renders a flex row with padding and a bottom hairline", () => {
    const { container } = render(<CardHeader>x</CardHeader>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("flex");
    expect(el.className).toContain("items-center");
    expect(el.className).toContain("justify-between");
    expect(el.className).toContain("border-b");
    expect(el.className).toContain("border-hair");
  });
});

describe("CardBody", () => {
  it("renders a div with card padding", () => {
    const { container } = render(<CardBody>x</CardBody>);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    // spacing comes from inline var([--pad-card]) utilities
    expect(el.className).toMatch(/px-\[var\(--pad-card\)\]/);
  });
});

describe("CardFooter", () => {
  it("renders a flex row with top hairline and dim text", () => {
    const { container } = render(<CardFooter>x</CardFooter>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-t");
    expect(el.className).toContain("border-hair");
    expect(el.className).toContain("text-ink-3");
  });
});

describe("Card composition", () => {
  it("renders a full header / body / footer composition", () => {
    const { getByText } = render(
      <Card>
        <CardHeader>H</CardHeader>
        <CardBody>B</CardBody>
        <CardFooter>F</CardFooter>
      </Card>
    );
    expect(getByText("H")).toBeDefined();
    expect(getByText("B")).toBeDefined();
    expect(getByText("F")).toBeDefined();
  });
});
