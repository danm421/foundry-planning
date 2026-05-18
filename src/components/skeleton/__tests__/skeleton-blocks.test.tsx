// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  SkeletonCard,
  SkeletonKpi,
  SkeletonTable,
  SkeletonChart,
  SkeletonForm,
} from "../skeleton-blocks";

describe("skeleton blocks", () => {
  it("SkeletonCard renders a default text placeholder", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(3);
  });
  it("SkeletonCard renders provided children instead of the default", () => {
    const { getByTestId } = render(
      <SkeletonCard>
        <span data-testid="child" />
      </SkeletonCard>,
    );
    expect(getByTestId("child")).toBeTruthy();
  });
  it("SkeletonKpi renders a label + value block", () => {
    const { container } = render(<SkeletonKpi />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(2);
  });
  it("SkeletonTable renders header + body rows", () => {
    const { container } = render(<SkeletonTable rows={3} columns={2} />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(8);
  });
  it("SkeletonChart renders a title + plot area", () => {
    const { container } = render(<SkeletonChart />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(2);
  });
  it("SkeletonForm renders a label + input per field", () => {
    const { container } = render(<SkeletonForm fields={3} />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(6);
  });
});
