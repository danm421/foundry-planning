import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import type { ReportArtifact, Variant, ChartImage, CsvFile } from "../types";

describe("ReportArtifact contract types", () => {
  it("accepts an artifact with empty options schema", () => {
    const optionsSchema = z.object({});
    type Opts = z.infer<typeof optionsSchema>;
    const a: ReportArtifact<{ x: number }, typeof optionsSchema> = {
      id: "test",
      title: "Test",
      section: "assets",
      route: "/clients/abc",
      variants: ["data", "csv"],
      optionsSchema,
      defaultOptions: {} as Opts,
      fetchData: async () => ({ data: { x: 1 }, asOf: new Date(), dataVersion: "v1" }),
      renderPdf: () => null,
    };
    expectTypeOf(a.id).toEqualTypeOf<string>();
  });

  it("Variant union covers chart, data, chart+data, csv", () => {
    const all: Variant[] = ["chart", "data", "chart+data", "csv"];
    expect(all).toHaveLength(4);
  });

  it("ChartImage carries dataVersion for drift detection", () => {
    const img: ChartImage = {
      id: "main", dataUrl: "data:image/png;base64,xyz",
      width: 800, height: 500, dataVersion: "v1",
    };
    expect(img.dataVersion).toBe("v1");
  });

  it("CsvFile shape", () => {
    const f: CsvFile = { name: "holdings.csv", contents: "a,b\n1,2\n" };
    expect(f.name).toBe("holdings.csv");
  });
});
