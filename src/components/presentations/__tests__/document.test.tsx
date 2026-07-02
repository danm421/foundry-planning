import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PresentationDocument } from "../document";
import type { ProjectionResult } from "@/engine";
import {
  makeProjectionYears,
  makeClientData,
} from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

describe("PresentationDocument", () => {
  it("renders cover + TOC + cash flow without throwing", async () => {
    const years = makeProjectionYears();
    const clientData = makeClientData();
    // Only the cashFlow page is rendered here; it consumes `years`, not the
    // estate `projection`. Stub the projection rather than running the full
    // estate engine on this minimal cash-flow fixture (which has no accounts /
    // planSettings and trips the today-hypothetical estate-tax invariants).
    const projection = { years } as unknown as ProjectionResult;
    const buf = await renderToBuffer(
      <PresentationDocument
        pages={[{ pageId: "cashFlow", options: undefined, scenarioKey: "base" }]}
        firmName="Foundry Planning"
        firmTagline={null}
        firmLogoDataUrl={null}
        accentColor="#b87f1f"
        clientName="Cooper Sample"
        reportDate="May 28, 2026"
        spouseName="Susan"
        spouseLastName="Sample"
        headerName="Cooper & Susan"
        bundles={{ base: { clientData, projection, scenarioLabel: "Base Case" } }}
        topScenarioKey="base"
      />,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
