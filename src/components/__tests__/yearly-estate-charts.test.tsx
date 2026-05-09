// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { YearlyEstateCharts } from "../yearly-estate-charts";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

const rows: YearlyEstateRow[] = [
  {
    year: 2026,
    ageClient: 56,
    ageSpouse: 51,
    grossEstate: 2_000_000,
    taxesAndExpenses: 200_000,
    charitableBequests: 100_000,
    netToHeirs: 1_700_000,
    heirsAssets: 0,
    totalToHeirs: 1_700_000,
    charity: 100_000,
    deaths: [],
  },
  {
    year: 2027,
    ageClient: 57,
    ageSpouse: 52,
    grossEstate: 2_200_000,
    taxesAndExpenses: 250_000,
    charitableBequests: 100_000,
    netToHeirs: 1_850_000,
    heirsAssets: 0,
    totalToHeirs: 1_850_000,
    charity: 100_000,
    deaths: [],
  },
];

const recipients: RecipientTotal[] = [
  {
    key: "family_member|c1",
    recipientLabel: "Charlie",
    recipientKind: "family_member",
    fromFirstDeath: 100_000,
    fromSecondDeath: 1_400_000,
    total: 1_500_000,
  },
  {
    key: "external_beneficiary|red-cross",
    recipientLabel: "Red Cross",
    recipientKind: "external_beneficiary",
    fromFirstDeath: 0,
    fromSecondDeath: 200_000,
    total: 200_000,
  },
];

describe("YearlyEstateCharts", () => {
  it("renders both chart canvases for non-empty inputs", () => {
    const { container } = render(
      <YearlyEstateCharts
        rows={rows}
        recipients={recipients}
        firstDeathYear={2055}
        secondDeathYear={2060}
      />,
    );
    expect(container.querySelectorAll("canvas").length).toBe(2);
  });

  it("renders nothing when rows are empty", () => {
    const { container } = render(
      <YearlyEstateCharts
        rows={[]}
        recipients={[]}
        firstDeathYear={null}
        secondDeathYear={null}
      />,
    );
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("renders only the 'where' chart if there are no non-spouse recipients", () => {
    const { container } = render(
      <YearlyEstateCharts
        rows={rows}
        recipients={[]}
        firstDeathYear={2055}
        secondDeathYear={2060}
      />,
    );
    expect(container.querySelectorAll("canvas").length).toBe(1);
  });
});
