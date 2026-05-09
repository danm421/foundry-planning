import type { ReactNode } from "react";
import type { z } from "zod";

export type Variant = "chart" | "data" | "chart+data" | "csv";

export type ChartImage = {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  dataVersion: string;
};

export type CsvFile = {
  name: string;
  contents: string;
};

export type ArtifactSection = "assets" | "cashflow" | "estate" | "overview";

export type FetchDataResult<TData> = {
  data: TData;
  asOf: Date;
  dataVersion: string;
};

export type RenderPdfInput<TData, TOpts> = {
  data: TData;
  opts: TOpts;
  variant: Variant;
  charts: ChartImage[];
};

export type FetchDataInput<TOptsSchema extends z.ZodTypeAny> = {
  clientId: string;
  opts: z.infer<TOptsSchema>;
};

export type ReportArtifact<TData, TOptsSchema extends z.ZodTypeAny> = {
  id: string;
  title: string;
  section: ArtifactSection;
  route: string;

  variants: [Variant, ...Variant[]];
  optionsSchema: TOptsSchema;
  defaultOptions: z.infer<TOptsSchema>;

  fetchData: (input: FetchDataInput<TOptsSchema>) => Promise<FetchDataResult<TData>>;

  // Returns a ReactNode of `<View>` blocks (NOT a `<Document>`). The
  // ArtifactDocument shell wraps the blocks. This is what enables
  // package mode (Plan 3) to concatenate multiple artifacts.
  renderPdf: (input: RenderPdfInput<TData, z.infer<TOptsSchema>>) => ReactNode;

  toCsv?: (data: TData, opts: z.infer<TOptsSchema>) => CsvFile[];
};

// Convenience: ReportArtifact with TData/TOpts erased — what the registry stores.
// `unknown` here is intentional: the registry hands artifacts back without
// retaining their generic params; consumers re-validate via optionsSchema.
export type AnyReportArtifact = ReportArtifact<unknown, z.ZodTypeAny>;
