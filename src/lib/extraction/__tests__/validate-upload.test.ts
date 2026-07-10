import { describe, it, expect } from "vitest";
import { detectUploadKind } from "../validate-upload";

// Both .xlsx and .docx are OOXML ZIP archives that begin with the same
// "PK\x03\x04" local-file-header signature. Detection tells them apart by
// the part name each format always carries (stored uncompressed in the zip),
// so a minimal buffer is just the signature followed by the marker name.
const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const zipWith = (entryName: string) =>
  Buffer.concat([PK, Buffer.from(entryName, "utf-8")]);

describe("detectUploadKind", () => {
  it("detects a PDF by its %PDF- signature", () => {
    expect(detectUploadKind(Buffer.from("%PDF-1.7\n%âãÏÓ"))).toBe("pdf");
  });

  it("detects CSV when the payload is textual and comma-bearing", () => {
    expect(detectUploadKind(Buffer.from("name,amount\nFidelity,100\n"))).toBe(
      "csv",
    );
  });

  it("detects a docx (OOXML zip containing word/document.xml)", () => {
    expect(detectUploadKind(zipWith("word/document.xml"))).toBe("docx");
  });

  it("treats an xlsx-shaped zip (no word part) as xlsx", () => {
    expect(detectUploadKind(zipWith("xl/workbook.xml"))).toBe("xlsx");
  });

  it("falls back to xlsx for an unrecognized zip payload", () => {
    expect(detectUploadKind(zipWith("some/other.bin"))).toBe("xlsx");
  });

  it("returns null for buffers shorter than the signature window", () => {
    expect(detectUploadKind(Buffer.from([0x25, 0x50]))).toBeNull();
  });

  it("returns null for binary payloads it can't classify", () => {
    expect(detectUploadKind(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))).toBeNull();
  });

  it("detects a PNG by its \\x89PNG signature", () => {
    expect(
      detectUploadKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("png");
  });

  it("detects a JPEG by its \\xFF\\xD8\\xFF signature", () => {
    expect(
      detectUploadKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
    ).toBe("jpeg");
  });

  it("still rejects GIF payloads", () => {
    expect(detectUploadKind(Buffer.from("GIF89a\x01\x00"))).toBeNull();
  });

  it("still rejects WebP payloads", () => {
    // RIFF....WEBP
    expect(
      detectUploadKind(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")])),
    ).toBeNull();
  });
});
