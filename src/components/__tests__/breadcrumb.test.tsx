// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
import Breadcrumb from "../breadcrumb";

describe("Breadcrumb", () => {
  it("renders 'Clients' for /clients", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients");
    const { container } = render(<Breadcrumb />);
    expect(container.textContent).toBe("Clients");
  });

  it("renders 'Clients / <householdTitle>' for a client sub-route", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/clients/abc-123/overview");
    const { container } = render(<Breadcrumb clientHouseholdTitle="Dan & Sarah Carver" />);
    expect(container.textContent).toContain("Clients");
    expect(container.textContent).toContain("Dan & Sarah Carver");
    expect(container.textContent).toContain("/");
  });

  it("renders 'CMA's' for /cma", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/cma");
    const { container } = render(<Breadcrumb />);
    expect(container.textContent).toBe("CMA's");
  });

  it("renders nothing sensible for unknown routes", () => {
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/");
    const { container } = render(<Breadcrumb />);
    expect(container.firstChild).not.toBeNull();
  });
});
