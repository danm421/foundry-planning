// @vitest-environment jsdom
// src/components/__tests__/details-shell.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("@/components/details-sidebar", () => ({
  default: ({ variant }: { variant: string }) => <nav data-testid="sidebar" data-variant={variant} />,
}));

import DetailsShell from "../details-shell";

describe("DetailsShell", () => {
  it.each([
    ["/clients/c1/details/accounts", "full", "grid-cols-[220px_1fr]"],
    ["/clients/c1/details/import/i1/chat", "full", "grid-cols-[220px_1fr]"],
    ["/clients/c1/details/map", "rail", "grid-cols-[56px_1fr]"],
    ["/clients/c1/details/import/i1/fact-finder", "rail", "grid-cols-[56px_1fr]"],
  ])("%s shows the %s sidebar", (path, variant, columns) => {
    pathname.current = path;
    const { container } = render(
      <DetailsShell clientId="c1">
        <p>content</p>
      </DetailsShell>,
    );
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-variant", variant);
    expect(container.firstElementChild).toHaveClass(columns);
  });
});
