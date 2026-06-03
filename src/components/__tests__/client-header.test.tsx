// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ClientHeader from "../client-header";
import type { PersonInfo } from "../client-identity-menu";

const people: PersonInfo[] = [
  {
    role: "primary",
    firstName: "Cooper",
    lastName: "Sample",
    dateOfBirth: "1971-03-12",
    email: "cooper@example.com",
    phone: null,
    mobile: null,
  },
];

describe("ClientHeader", () => {
  it("renders an always-compact sticky bar (no tall state)", () => {
    const { container } = render(<ClientHeader clientId="abc" people={people} />);
    const bar = container.firstChild as HTMLElement;
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("h-[44px]");
    expect(bar.className).not.toContain("h-[100px]");
  });

  it("renders the identity trigger and the right slot", () => {
    render(
      <ClientHeader
        clientId="abc"
        people={people}
        rightSlot={<span>chips-here</span>}
      />,
    );
    expect(screen.getByText("Cooper Sample")).toBeInTheDocument();
    expect(screen.getByText("chips-here")).toBeInTheDocument();
  });
});
