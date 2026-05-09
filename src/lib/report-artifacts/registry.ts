import type { AnyReportArtifact, ReportArtifact } from "./types";
import type { z } from "zod";

const artifacts = new Map<string, AnyReportArtifact>();

// Upsert by id. Re-registration is idempotent so HMR-driven module
// re-evaluations don't crash the bootstrap. Last writer wins.
export function registerArtifact<TData, TOpts extends z.ZodTypeAny>(
  artifact: ReportArtifact<TData, TOpts>,
): void {
  artifacts.set(artifact.id, artifact as unknown as AnyReportArtifact);
}

export function getArtifact(id: string): AnyReportArtifact | undefined {
  return artifacts.get(id);
}

export function listArtifacts(): AnyReportArtifact[] {
  return Array.from(artifacts.values());
}

// Test-only: clears the registry. Not exported from the package barrel.
export function _resetRegistry(): void {
  artifacts.clear();
}
