// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MoneyText from "../money-text";

describe("MoneyText", () => {
  describe("currency (default format)", () => {
    it("formats a positive integer as USD without decimals", () => {
      render(<MoneyText value={2118400} />);
      expect(screen.getByText("$2,118,400")).toBeDefined();
    });

    it("formats zero as $0", () => {
      render(<MoneyText value={0} />);
      expect(screen.getByText("$0")).toBeDefined();
    });

    it("formats a negative value with a leading minus", () => {
      render(<MoneyText value={-12345} />);
      expect(screen.getByText("-$12,345")).toBeDefined();
    });
  });

  describe("percent format", () => {
    it("formats a ratio as a 1-decimal percent", () => {
      render(<MoneyText value={0.042} format="pct" />);
      expect(screen.getByText("4.2%")).toBeDefined();
    });

    it("formats zero as 0.0%", () => {
      render(<MoneyText value={0} format="pct" />);
      expect(screen.getByText("0.0%")).toBeDefined();
    });
  });

  describe("integer format", () => {
    it("formats an integer with thousands separators", () => {
      render(<MoneyText value={82} format="int" />);
      expect(screen.getByText("82")).toBeDefined();
    });

    it("formats a negative integer", () => {
      render(<MoneyText value={-1200} format="int" />);
      expect(screen.getByText("-1,200")).toBeDefined();
    });
  });

  describe("nullish and non-finite values", () => {
    it("renders an em-dash for null", () => {
      render(<MoneyText value={null} />);
      expect(screen.getByText("—")).toBeDefined();
    });

    it("renders an em-dash for undefined", () => {
      render(<MoneyText value={undefined} />);
      expect(screen.getByText("—")).toBeDefined();
    });

    it("renders an em-dash for NaN", () => {
      render(<MoneyText value={Number.NaN} />);
      expect(screen.getByText("—")).toBeDefined();
    });

    it("renders an em-dash for Infinity", () => {
      render(<MoneyText value={Number.POSITIVE_INFINITY} />);
      expect(screen.getByText("—")).toBeDefined();
    });
  });

  describe("classes", () => {
    it("applies the .tabular class for tabular-nums styling", () => {
      const { container } = render(<MoneyText value={100} />);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain("tabular");
    });

    it("applies kpi size class when size=kpi", () => {
      const { container } = render(<MoneyText value={100} size="kpi" />);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toMatch(/text-\[30px\]/);
    });

    it("passes through className", () => {
      const { container } = render(<MoneyText value={100} className="custom" />);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain("custom");
    });
  });
});
