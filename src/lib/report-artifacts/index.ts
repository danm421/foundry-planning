// Importing this module is what populates the registry. Route handlers
// and modal components import from here to ensure registration runs.
import { registerArtifact } from "./registry";
import { investmentsArtifact } from "./artifacts/investments";

registerArtifact(investmentsArtifact);

export { getArtifact, listArtifacts } from "./registry";
export type { Variant, ChartImage, CsvFile, ReportArtifact, AnyReportArtifact } from "./types";
