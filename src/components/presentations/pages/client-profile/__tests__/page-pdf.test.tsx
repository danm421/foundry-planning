import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { ClientProfilePagePdf } from "../page-pdf";
import type { ClientProfilePageData } from "@/lib/presentations/pages/client-profile/types";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

const couple: ClientProfilePageData = {
  title: "Client Profile",
  subtitle: "Base Case",
  persons: [
    { name: "John Smith", dob: "1968-03-12", age: 58, retirementAge: 65, retirementYear: 2033, lifeExpectancyAge: 90, lifeExpectancyYear: 2058 },
    { name: "Jane Smith", dob: "1970-07-04", age: 56, retirementAge: 63, retirementYear: 2033, lifeExpectancyAge: 94, lifeExpectancyYear: 2064 },
  ],
  children: [
    { name: "Emma Smith", dob: "2013-01-01", age: 13 },
    { name: "Liam", dob: null, age: null },
  ],
  income: [
    { name: "John Salary", typeLabel: "Salary", amount: 120000, active: true, startYear: 2020, endYear: 2032 },
    { name: "Pension", typeLabel: "Deferred Comp", amount: 30000, active: false, startYear: 2033, endYear: null },
    { name: "SS — Jane", typeLabel: "Social Security (spousal)", amount: 21600, active: false, startYear: 2037, endYear: null },
  ],
  incomeNotes: [
    "Jane draws a spousal benefit of $21,600/yr on John's work record, starting in 2037 once both have filed.",
  ],
  expenseColumns: [
    { label: "Current", year: 2026 },
    { label: "Retirement", year: 2033 },
  ],
  expenses: [
    { label: "Living", amounts: [52400, 60000], isTotal: false },
    { label: "Taxes", amounts: [41000, 22000], isTotal: false },
    { label: "Total", amounts: [99400, 88000], isTotal: true },
  ],
};

const single: ClientProfilePageData = {
  title: "Client Profile",
  subtitle: "Base Case",
  persons: [couple.persons[0]],
  children: [],
  income: [],
  incomeNotes: [],
  expenseColumns: [],
  expenses: [],
};

describe("ClientProfilePagePdf", () => {
  it("renders a couple with children, income, and expenses without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        <ClientProfilePagePdf
          data={couple}
          firmName="Foundry Planning"
          clientName="John & Jane Smith"
          reportDate="June 1, 2026"
          pageIndex={0}
          totalPages={1}
          accent={DEFAULT_ACCENT}
        />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders four expense columns without throwing", async () => {
    ensureFontsRegistered();
    const fourColumns: ClientProfilePageData = {
      ...couple,
      expenseColumns: [
        { label: "Current", year: 2026 },
        { label: "In 4 Years", year: 2030 },
        { label: "Retirement", year: 2033 },
        { label: "In 20 Years", year: 2046 },
      ],
      expenses: couple.expenses.map((r) => ({ ...r, amounts: [...r.amounts, ...r.amounts] })),
    };
    const buf = await renderToBuffer(
      <Document>
        <ClientProfilePagePdf
          data={fourColumns}
          firmName="Foundry Planning"
          clientName="John & Jane Smith"
          reportDate="June 1, 2026"
          pageIndex={0}
          totalPages={1}
          accent={DEFAULT_ACCENT}
        />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders a single client with no children/income/expenses without throwing", async () => {
    ensureFontsRegistered();
    const buf = await renderToBuffer(
      <Document>
        <ClientProfilePagePdf
          data={single}
          firmName="Foundry"
          clientName="John Smith"
          reportDate="June 1, 2026"
          pageIndex={0}
          totalPages={1}
          accent={DEFAULT_ACCENT}
        />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
