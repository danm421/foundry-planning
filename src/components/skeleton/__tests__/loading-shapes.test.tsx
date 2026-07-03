// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ListLoading from "../list-loading";
import FormLoading from "../form-loading";
import PortalLoading from "../portal-loading";

describe("ListLoading", () => {
  it("is an aria-busy region with an SR label and a table body", () => {
    const { container, getByText } = render(<ListLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(getByText("Loading…").className).toContain("sr-only");
    // header (title + action) = 2, SkeletonTable(8,5) = 5*(8+1) = 45
    expect(container.querySelectorAll(".skeleton-block").length).toBe(47);
  });
});

describe("FormLoading", () => {
  it("is an aria-busy region with an SR label and form fields", () => {
    const { container, getByText } = render(<FormLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(getByText("Loading…").className).toContain("sr-only");
    // SkeletonForm(5) = 5*2 = 10
    expect(container.querySelectorAll(".skeleton-block").length).toBe(10);
  });
});

describe("PortalLoading", () => {
  it("is an aria-busy region with an SR label, KPIs, and a list", () => {
    const { container, getByText } = render(<PortalLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(getByText("Loading…").className).toContain("sr-only");
    // 3 KPIs * 2 = 6, SkeletonTable(6,4) = 4*(6+1) = 28
    expect(container.querySelectorAll(".skeleton-block").length).toBe(34);
  });
});
