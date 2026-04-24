// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ClientHeader from "../client-header";

type ClientFixture = Parameters<typeof ClientHeader>[0]["client"];

function makeClient(overrides: Partial<ClientFixture> = {}): ClientFixture {
  return {
    id: "c1",
    firstName: "Dan",
    lastName: "Carver",
    dateOfBirth: "1970-05-01" as unknown as Date,
    spouseName: "Sarah",
    spouseLastName: "Carver",
    spouseDob: "1972-10-10" as unknown as Date,
    ...overrides,
  } as ClientFixture;
}

describe("ClientHeader", () => {
  it("renders the household name for a couple", () => {
    const { container } = render(
      <ClientHeader client={makeClient()} advisorName="Priya Anand" />,
    );
    expect(container.textContent).toContain("Dan & Sarah Carver");
  });

  it("renders the household name for a single", () => {
    const { container } = render(
      <ClientHeader
        client={makeClient({ spouseName: null, spouseLastName: null, spouseDob: null })}
        advisorName="Priya Anand"
      />,
    );
    expect(container.textContent).toContain("Dan Carver");
    expect(container.textContent).not.toContain("&");
  });

  it("renders both ages for a couple", () => {
    const { container } = render(
      <ClientHeader client={makeClient()} advisorName="Priya Anand" />,
    );
    expect(container.textContent).toMatch(/Ages\s+\d+\s+&\s+\d+/);
  });

  it("renders single age for a single", () => {
    const { container } = render(
      <ClientHeader
        client={makeClient({ spouseName: null, spouseLastName: null, spouseDob: null })}
        advisorName="Priya Anand"
      />,
    );
    expect(container.textContent).toMatch(/Age\s+\d+/);
    expect(container.textContent).not.toContain("Ages");
  });

  it("renders the lead advisor name", () => {
    const { container } = render(
      <ClientHeader client={makeClient()} advisorName="Priya Anand" />,
    );
    expect(container.textContent).toContain("Lead advisor: Priya Anand");
  });

  it("renders a 52×52 portrait with initials", () => {
    const { container } = render(
      <ClientHeader client={makeClient()} advisorName="Priya Anand" />,
    );
    const portrait = container.querySelector('[data-testid="client-portrait"]');
    expect(portrait).not.toBeNull();
    expect(portrait?.textContent).toBe("DC");
  });

  it("uses a deterministic gradient (same id → same classes)", () => {
    const { container: a } = render(
      <ClientHeader client={makeClient({ id: "same" })} advisorName="x" />,
    );
    const { container: b } = render(
      <ClientHeader client={makeClient({ id: "same" })} advisorName="x" />,
    );
    const portraitA = a.querySelector('[data-testid="client-portrait"]') as HTMLElement;
    const portraitB = b.querySelector('[data-testid="client-portrait"]') as HTMLElement;
    expect(portraitA.className).toBe(portraitB.className);
  });
});
