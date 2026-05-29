import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PresentationDocument } from "../document";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  makeProjectionYears,
  makeClientData,
} from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

describe("PresentationDocument", () => {
  it("renders cover + TOC + cash flow without throwing", async () => {
    const years = makeProjectionYears();
    const clientData = makeClientData();
    const projection = runProjectionWithEvents(clientData);
    const buf = await renderToBuffer(
      <PresentationDocument
        pages={[{ pageId: "cashFlow", options: undefined }]}
        firmName="Foundry Planning"
        firmTagline={null}
        clientName="Cooper Sample"
        reportDate="May 28, 2026"
        scenarioLabel="Base Case"
        spouseName="Susan Sample"
        years={years}
        projection={projection}
        clientData={clientData}
      />,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
