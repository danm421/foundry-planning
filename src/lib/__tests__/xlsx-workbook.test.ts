import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readGrid } from "@/lib/crm/import/read-file";
import { extractExcelText } from "@/lib/extraction/excel-parser";

// ExcelJS's loader class isn't exported; reach it through a workbook.
const xlsxLoader = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
  load: (...args: unknown[]) => Promise<unknown>;
};

async function workbook(build: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet("Sheet1"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Rewrite the first worksheet's XML, for shapes ExcelJS won't write itself. */
async function patchSheet(buffer: Buffer, patch: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const path = "xl/worksheets/sheet1.xml";
  zip.file(path, patch(await zip.file(path)!.async("string")));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading an uploaded spreadsheet", () => {
  it("refuses a row numbered past Excel's last row without loading the file", async () => {
    const buffer = await patchSheet(
      await workbook((ws) => ws.addRow(["Name"])),
      (xml) => xml.replace("</sheetData>", '<row r="4000000000"/></sheetData>'),
    );
    // Stand-in loader, so nothing here is sized from that row number.
    const load = vi.spyOn(xlsxLoader, "load").mockResolvedValue(undefined);

    await expect(readGrid(buffer)).rejects.toThrow("too large to read");
    expect(await extractExcelText(buffer)).toBe("");
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a cell numbered past Excel's last row without loading the file", async () => {
    const buffer = await patchSheet(
      await workbook((ws) => ws.addRow(["Name"])),
      (xml) => xml.replace('r="A1"', 'r="A2000000"'),
    );
    const load = vi.spyOn(xlsxLoader, "load").mockResolvedValue(undefined);

    await expect(readGrid(buffer)).rejects.toThrow("too large to read");
    expect(load).not.toHaveBeenCalled();
  });

  it("skips the validation and column ranges both readers never use", async () => {
    const buffer = await workbook((ws) => ws.addRow(["Name"]));
    const load = vi.spyOn(xlsxLoader, "load");

    await readGrid(buffer);
    await extractExcelText(buffer);

    expect(load).toHaveBeenCalledTimes(2);
    for (const [, options] of load.mock.calls) {
      expect(options).toEqual({
        ignoreNodes: expect.arrayContaining(["dataValidations", "cols"]),
      });
      expect((options as { ignoreNodes: string[] }).ignoreNodes).not.toContain("mergeCells");
    }
  });

  it("keeps a normal merged area, so every cell in it reads its value", async () => {
    const buffer = await workbook((ws) => {
      ws.addRow(["Name", "Advisor"]);
      ws.addRow(["Ada", "Jane"]);
      ws.addRow(["Grace", ""]);
      ws.mergeCells("B2:B3");
    });

    expect((await readGrid(buffer)).slice(1)).toEqual([
      ["Ada", "Jane"],
      ["Grace", "Jane"],
    ]);
  });

  it("skips merges past the cap and reads the value once, as Excel shows it", async () => {
    const buffer = await patchSheet(
      await workbook((ws) => ws.addRow(["Name", "", ""])),
      (xml) =>
        xml.replace(
          "</sheetData>",
          '</sheetData><mergeCells count="1"><mergeCell ref="A1:Z5000"/></mergeCells>',
        ),
    );

    const grid = await readGrid(buffer);

    expect(grid[0].filter((cell) => cell === "Name")).toHaveLength(1);
  });
});
