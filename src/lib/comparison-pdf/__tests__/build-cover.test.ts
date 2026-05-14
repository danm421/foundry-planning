import { describe, expect, it } from "vitest";
import { buildCoverProps } from "../build-cover";

const layout = {
  version: 5 as const,
  title: "Retirement Readiness",
  groups: [],
};

const baseClient = {
  firstName: "John",
  lastName: "Doe",
  spouseName: null,
  spouseLastName: null,
};

const branding = {
  primaryColor: "#0066cc",
  firmName: "Acme Wealth",
  logoDataUrl: "data:image/png;base64,AAAA",
};

describe("buildCoverProps", () => {
  it("uses the layout title as the cover title", () => {
    const props = buildCoverProps({
      layout,
      client: baseClient,
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.title).toBe("Retirement Readiness");
  });

  it("builds household name from first + last", () => {
    const props = buildCoverProps({
      layout,
      client: baseClient,
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.householdName).toBe("John Doe");
  });

  it("joins spouse name when present", () => {
    const props = buildCoverProps({
      layout,
      client: { ...baseClient, spouseName: "Jane", spouseLastName: "Doe" },
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.householdName).toBe("John & Jane Doe");
  });

  it("falls back to client surname when spouseLastName missing", () => {
    const props = buildCoverProps({
      layout,
      client: { ...baseClient, spouseName: "Jane", spouseLastName: null },
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.householdName).toBe("John & Jane Doe");
  });

  it("emits eyebrow as 'FIRM · YEAR' uppercase", () => {
    const props = buildCoverProps({
      layout,
      client: baseClient,
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.eyebrow).toBe("ACME WEALTH · 2026");
  });

  it("formats asOf as ISO YYYY-MM-DD", () => {
    const props = buildCoverProps({
      layout,
      client: baseClient,
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.asOfIso).toBe("2026-05-13");
  });

  it("passes branding through verbatim", () => {
    const props = buildCoverProps({
      layout,
      client: baseClient,
      branding,
      advisorName: "Jane Advisor",
      asOf: new Date("2026-05-13T12:00:00Z"),
    });
    expect(props.primaryColor).toBe("#0066cc");
    expect(props.firmName).toBe("Acme Wealth");
    expect(props.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(props.advisorName).toBe("Jane Advisor");
  });
});
