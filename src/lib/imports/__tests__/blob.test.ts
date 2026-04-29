import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
}));

import { put, del } from "@vercel/blob";
import { uploadImportFile, deleteImportFile } from "../blob";

beforeEach(() => {
  vi.mocked(put).mockReset();
  vi.mocked(del).mockReset();
  vi.mocked(put).mockImplementation(
    async (pathname: string) =>
      ({
        url: `https://blob.example/${pathname}`,
        pathname,
        contentType: "application/pdf",
        contentDisposition: "",
        downloadUrl: `https://blob.example/${pathname}?download=1`,
      }) as never,
  );
  vi.mocked(del).mockResolvedValue(undefined);
});

describe("uploadImportFile", () => {
  it("writes to imports/<importId>/<fileId>/<safe-filename> with private access", async () => {
    const file = new Blob(["x"], { type: "application/pdf" });
    const result = await uploadImportFile({
      importId: "imp-1",
      fileId: "f-1",
      filename: "Statement Q1 2026.pdf",
      body: file,
    });
    expect(result.url).toContain("imports/imp-1/f-1/Statement_Q1_2026.pdf");
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = vi.mocked(put).mock.calls[0];
    expect(pathname).toBe("imports/imp-1/f-1/Statement_Q1_2026.pdf");
    expect(body).toBe(file);
    expect(opts).toMatchObject({ access: "private", addRandomSuffix: false });
  });

  it("sanitizes filenames with shell-unfriendly characters", async () => {
    const file = new Blob(["y"], { type: "application/pdf" });
    await uploadImportFile({
      importId: "imp-2",
      fileId: "f-2",
      filename: "../../etc/passwd; rm -rf /.pdf",
      body: file,
    });
    const [pathname] = vi.mocked(put).mock.calls[0];
    expect(pathname).not.toContain("..");
    expect(pathname).not.toContain(";");
    expect(pathname).not.toContain(" ");
    expect(pathname).toMatch(/^imports\/imp-2\/f-2\/[A-Za-z0-9._-]+$/);
  });
});

describe("deleteImportFile", () => {
  it("calls del with the pathname", async () => {
    await deleteImportFile("imports/imp-1/f-1/file.pdf");
    expect(del).toHaveBeenCalledWith("imports/imp-1/f-1/file.pdf");
  });
});
