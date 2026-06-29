import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractDocxText } from "../docx-parser";

// Build a minimal-but-valid .docx (OOXML package) in memory so the test has
// no binary fixture to maintain. mammoth resolves the main document through
// the package relationships, so we ship the three parts it needs:
// [Content_Types].xml, _rels/.rels, and word/document.xml.
async function buildDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractDocxText", () => {
  it("returns an empty string for an empty buffer", async () => {
    expect(await extractDocxText(Buffer.alloc(0))).toBe("");
  });

  it("returns an empty string for a non-docx (garbage) buffer", async () => {
    expect(await extractDocxText(Buffer.from("not a zip at all"))).toBe("");
  });

  it("extracts the prose from a minimal docx", async () => {
    const buf = await buildDocx("Hello from a Word document.");
    const text = await extractDocxText(buf);
    expect(text).toContain("Hello from a Word document.");
  });
});
