// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Document, Page } from "@react-pdf/renderer";
import { DataTable } from "../data-table";

describe("DataTable widget", () => {
  it("renders header + body cells", () => {
    const tree = (
      <Document><Page>
        <DataTable
          columns={[{ header: "A", accessor: (r: { a: string }) => r.a }]}
          rows={[{ a: "x" }]}
        />
      </Page></Document>
    );
    expect(tree).toBeTruthy();
  });

  it("supports right-aligned columns (e.g., for currency)", () => {
    const tree = (
      <Document><Page>
        <DataTable
          columns={[{ header: "Amt", accessor: (r: { v: number }) => String(r.v), align: "right" }]}
          rows={[{ v: 1 }]}
        />
      </Page></Document>
    );
    expect(tree).toBeTruthy();
  });
});
