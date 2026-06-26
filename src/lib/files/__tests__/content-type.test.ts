// src/lib/files/__tests__/content-type.test.ts
import { describe, it, expect } from "vitest";
import { detectDocumentKind, validateDocumentUpload } from "../content-type";

const pdf = Buffer.from("%PDF-1.4\n%â…\n");
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from("heic")]);
const csv = Buffer.from("name,amount\nAcme,100\n");
const html = Buffer.from("<html><script>alert(1)</script></html>");
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const xmlSvg = Buffer.from('<?xml version="1.0"?>\n<svg></svg>');
const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
const tooShort = Buffer.from([0x25]);
const unknownBin = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);

describe("detectDocumentKind", () => {
  it("recognizes allowed binary kinds", () => {
    expect(detectDocumentKind(pdf)).toBe("pdf");
    expect(detectDocumentKind(zip)).toBe("office-zip");
    expect(detectDocumentKind(ole)).toBe("office-ole");
    expect(detectDocumentKind(png)).toBe("png");
    expect(detectDocumentKind(jpeg)).toBe("jpeg");
    expect(detectDocumentKind(gif)).toBe("gif");
    expect(detectDocumentKind(webp)).toBe("webp");
    expect(detectDocumentKind(heic)).toBe("heic");
  });
  it("treats control-char-free non-markup bytes as text/csv", () => {
    expect(detectDocumentKind(csv)).toBe("text");
  });
  it("rejects markup, executables, too-short, and unknown binary", () => {
    expect(detectDocumentKind(html)).toBeNull();
    expect(detectDocumentKind(svg)).toBeNull();
    expect(detectDocumentKind(xmlSvg)).toBeNull();
    expect(detectDocumentKind(exe)).toBeNull();
    expect(detectDocumentKind(tooShort)).toBeNull();
    expect(detectDocumentKind(unknownBin)).toBeNull();
  });
});

describe("validateDocumentUpload", () => {
  it("returns canonical mime for unambiguous kinds", () => {
    expect(validateDocumentUpload(new File([pdf], "a.pdf"), pdf)).toEqual({ kind: "pdf", mimeType: "application/pdf" });
    expect(validateDocumentUpload(new File([png], "a.png"), png)).toEqual({ kind: "png", mimeType: "image/png" });
  });
  it("trusts an allowlisted client mime for office-zip, else octet-stream", () => {
    const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(validateDocumentUpload(new File([zip], "a.xlsx", { type: xlsxType }), zip)).toEqual({ kind: "office-zip", mimeType: xlsxType });
    expect(validateDocumentUpload(new File([zip], "a.xlsx", { type: "text/html" }), zip)).toEqual({ kind: "office-zip", mimeType: "application/octet-stream" });
  });
  it("throws on a disallowed/unsafe file", () => {
    expect(() => validateDocumentUpload(new File([html], "evil.pdf", { type: "application/pdf" }), html)).toThrow(/unsupported or unsafe/i);
  });
});
