// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstateDeltaChip, EstateRowMarker } from "@/components/estate-delta-chip";

describe("EstateDeltaChip", () => {
  it("renders nothing for a zero delta", () => {
    const { container } = render(<EstateDeltaChip delta={0} goodDirection="down" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for sub-dollar float noise", () => {
    const { container } = render(<EstateDeltaChip delta={0.4} goodDirection="down" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a down arrow and the magnitude for a fall", () => {
    render(<EstateDeltaChip delta={-1_100_000} goodDirection="down" />);
    expect(screen.getByTestId("estate-delta-chip")).toHaveTextContent("$1.1M");
    expect(screen.getByTestId("estate-delta-chip")).toHaveTextContent("▾");
  });

  it("shows an up arrow for a rise", () => {
    render(<EstateDeltaChip delta={240_000} goodDirection="up" />);
    expect(screen.getByTestId("estate-delta-chip")).toHaveTextContent("▴");
  });

  it("treats a fall as good news when goodDirection is down", () => {
    render(<EstateDeltaChip delta={-1_000} goodDirection="down" />);
    expect(screen.getByTestId("estate-delta-chip")).toHaveAttribute(
      "data-tone",
      "good",
    );
  });

  it("treats the same fall as bad news when goodDirection is up", () => {
    render(<EstateDeltaChip delta={-1_000} goodDirection="up" />);
    expect(screen.getByTestId("estate-delta-chip")).toHaveAttribute(
      "data-tone",
      "bad",
    );
  });

  it("spells the change out for screen readers", () => {
    render(<EstateDeltaChip delta={-1_100_000} goodDirection="down" />);
    expect(screen.getByTestId("estate-delta-chip")).toHaveAttribute(
      "aria-label",
      "Down $1.1M versus the compared plan",
    );
  });

  it("takes a caller-supplied testId so a specific subtotal chip can be addressed", () => {
    render(<EstateDeltaChip delta={-1_000} goodDirection="down" testId="estate-delta-gross-estate" />);
    const chip = screen.getByTestId("estate-delta-gross-estate");
    expect(chip).toHaveAttribute("data-tone", "good");
    expect(screen.queryByTestId("estate-delta-chip")).not.toBeInTheDocument();
  });
});

describe("EstateRowMarker", () => {
  it("renders nothing for an unchanged row", () => {
    const { container } = render(<EstateRowMarker status="same" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a changed row — the chip already carries that", () => {
    const { container } = render(<EstateRowMarker status="changed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels an added row", () => {
    render(<EstateRowMarker status="added" />);
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("labels a removed row", () => {
    render(<EstateRowMarker status="removed" />);
    expect(screen.getByText("removed")).toBeInTheDocument();
  });
});
