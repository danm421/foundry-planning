import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PresentationDocument } from "../document";
import type { ProjectionResult } from "@/engine";
import type { PageScenarioBundle } from "../document";
import {
  makeProjectionYears,
  makeClientData,
} from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

function makeBundleFixture(scenarioLabel: string): PageScenarioBundle {
  const years = makeProjectionYears();
  const clientData = makeClientData();
  // Stub projection rather than running the full estate engine on this
  // minimal cash-flow fixture (no accounts/planSettings).
  const projection = { years } as unknown as ProjectionResult;
  return { clientData, projection, scenarioLabel };
}

describe("PresentationDocument — multi-scenario bundle selection", () => {
  it("renders a deck where two pages read different bundles", async () => {
    const base = makeBundleFixture("Base Case");
    const alt = makeBundleFixture("Retire at 67");

    const buf = await renderToBuffer(
      <PresentationDocument
        pages={[
          { pageId: "cashFlow", options: undefined, scenarioKey: "base" },
          { pageId: "cashFlow", options: undefined, scenarioKey: "scenario:alt" },
        ]}
        firmName="Foundry Planning"
        firmTagline={null}
        firmLogoDataUrl={null}
        accentColor="#b87f1f"
        clientName="Cooper Sample"
        reportDate="January 1, 2026"
        spouseName={null}
        spouseLastName={null}
        headerName="Cooper Sample"
        bundles={{ base, "scenario:alt": alt }}
        topScenarioKey="base"
      />,
    );

    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("falls back to the top bundle when a page key is missing", async () => {
    const base = makeBundleFixture("Base Case");

    const buf = await renderToBuffer(
      <PresentationDocument
        pages={[
          { pageId: "cashFlow", options: undefined, scenarioKey: "scenario:ghost" },
        ]}
        firmName="Foundry Planning"
        firmTagline={null}
        firmLogoDataUrl={null}
        accentColor="#b87f1f"
        clientName="Cooper Sample"
        reportDate="January 1, 2026"
        spouseName={null}
        spouseLastName={null}
        headerName="Cooper Sample"
        bundles={{ base }}
        topScenarioKey="base"
      />,
    );

    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
