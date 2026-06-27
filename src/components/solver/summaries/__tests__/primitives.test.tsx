// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SummaryLayout, SummarySection, SummaryKpiRow, SummaryKpiCard, SummaryTable, SummaryNarrative } from "../primitives";

describe("summary primitives", () => {
  it("render without crashing", () => {
    const { getByText } = render(
      <SummaryLayout title="Title" subtitle="Sub">
        <SummaryKpiRow>
          <SummaryKpiCard label="Prob. of Success" value="92%" />
        </SummaryKpiRow>
        <SummarySection heading="Funding">
          <SummaryTable
            columns={[{ key: "label", header: "Source" }, { key: "value", header: "Amount", align: "right" }]}
            rows={[{ label: "Pensions", value: "$1.2M" }]}
          />
        </SummarySection>
        <SummaryNarrative items={["Point one."]} />
      </SummaryLayout>,
    );
    expect(getByText("Title")).toBeTruthy();
    expect(getByText("92%")).toBeTruthy();
    expect(getByText("Pensions")).toBeTruthy();
  });
});
