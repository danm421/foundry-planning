import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { ClientProfilePagePdf } from "../page-pdf";
import type { ClientProfilePageData } from "@/lib/presentations/pages/client-profile/types";

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
  ],
  expenses: [
    { label: "Living", current: 52400, retirement: 60000, isTotal: false },
    { label: "Taxes", current: 41000, retirement: 22000, isTotal: false },
    { label: "Total", current: 99400, retirement: 88000, isTotal: true },
  ],
};

const single: ClientProfilePageData = {
  title: "Client Profile",
  subtitle: "Base Case",
  persons: [couple.persons[0]],
  children: [],
  income: [],
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
        />
      </Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
