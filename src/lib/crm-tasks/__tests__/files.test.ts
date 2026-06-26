import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmTasks, crmTaskFiles, crmTaskActivity, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn().mockResolvedValue({ userId: "u_task_files", orgId: "org_task_files", actor: null }) };
});

import { put, del } from "@vercel/blob";
import { uploadCrmTaskFile, deleteCrmTaskFile, getCrmTaskFileRow } from "../files";

const FIRM = "org_task_files";
let taskId: string;

function pdfFile(name: string): File {
  const body = new Uint8Array(16);
  body.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], 0);
  return new File([body], name, { type: "application/pdf" });
}

async function cleanup() {
  const tasks = await db.query.crmTasks.findMany({ where: eq(crmTasks.firmId, FIRM), columns: { id: true } });
  for (const t of tasks) {
    await db.delete(crmTaskActivity).where(eq(crmTaskActivity.taskId, t.id));
    await db.delete(crmTaskFiles).where(eq(crmTaskFiles.taskId, t.id));
  }
  await db.delete(crmTasks).where(eq(crmTasks.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
  await db.delete(auditLog).where(eq(auditLog.firmId, FIRM));
}

beforeEach(async () => {
  vi.mocked(put).mockReset();
  vi.mocked(del).mockReset();
  vi.mocked(put).mockImplementation(async (pathname: string) => ({ url: `https://b/${pathname}`, pathname }) as never);
  vi.mocked(del).mockResolvedValue(undefined);
  await cleanup();
  const [h] = await db.insert(crmHouseholds).values({ firmId: FIRM, advisorId: "u_task_files", name: "HH" }).returning();
  const [t] = await db.insert(crmTasks).values({ firmId: FIRM, title: "T", createdByUserId: "u_task_files", householdId: h.id }).returning();
  taskId = t.id;
});

describe("uploadCrmTaskFile", () => {
  it("writes to the PRIVATE store (no public token) and stores the pathname", async () => {
    const row = await uploadCrmTaskFile({ taskId, firmId: FIRM, uploadedByUserId: "u_task_files", file: pdfFile("a.pdf") });
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = vi.mocked(put).mock.calls[0];
    expect(opts).toMatchObject({ access: "private", addRandomSuffix: false });
    expect(opts).not.toHaveProperty("token"); // the hole-closing assertion
    expect(row.storageKey).toBe(pathname);
    expect(row.storageKey).toMatch(new RegExp(`^crm-tasks/${FIRM}/${taskId}/\\d+-[0-9a-f-]+-a\\.pdf$`));
    expect(row.mimeType).toBe("application/pdf");
    expect(body).toBeInstanceOf(File);
  });

  it("rejects a disallowed file and writes nothing", async () => {
    const html = new File([new TextEncoder().encode("<html></html>")], "x.pdf", { type: "application/pdf" });
    await expect(uploadCrmTaskFile({ taskId, firmId: FIRM, uploadedByUserId: "u_task_files", file: html })).rejects.toThrow(/unsupported or unsafe/i);
    expect(put).not.toHaveBeenCalled();
    const rows = await db.select().from(crmTaskFiles).where(eq(crmTaskFiles.taskId, taskId));
    expect(rows).toHaveLength(0);
  });
});

describe("getCrmTaskFileRow", () => {
  it("returns the row for the right task, null for the wrong task", async () => {
    const row = await uploadCrmTaskFile({ taskId, firmId: FIRM, uploadedByUserId: "u_task_files", file: pdfFile("b.pdf") });
    expect((await getCrmTaskFileRow(row.id, taskId))?.id).toBe(row.id);
    expect(await getCrmTaskFileRow(row.id, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("deleteCrmTaskFile", () => {
  it("deletes on the default (private) token — no public token arg", async () => {
    const row = await uploadCrmTaskFile({ taskId, firmId: FIRM, uploadedByUserId: "u_task_files", file: pdfFile("c.pdf") });
    await deleteCrmTaskFile({ fileId: row.id, taskId, firmId: FIRM, userId: "u_task_files" });
    expect(del).toHaveBeenCalledWith(row.storageKey);
  });
});
