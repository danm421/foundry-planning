import type { AnyReportArtifact, ReportArtifact } from "./types";
import type { z } from "zod";

const artifacts = new Map<string, AnyReportArtifact>();

export function registerArtifact<TData, TOpts extends z.ZodTypeAny>(
  artifact: ReportArtifact<TData, TOpts>,
): void {
  if (artifacts.has(artifact.id)) {
    throw new Error(`Artifact "${artifact.id}" already registered`);
  }
  // Erase generics for storage; consumers re-validate options via schema.
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
