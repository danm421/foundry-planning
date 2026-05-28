import { db } from "@/db";
import { presentationTemplates } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import type { TemplateDescriptor } from "./template-descriptor-schema";

export type TemplateVisibility = "shared" | "private";

export interface TemplateRow {
  id: string;
  firmId: string;
  createdByUserId: string;
  visibility: TemplateVisibility;
  name: string;
  pages: TemplateDescriptor[];
  createdAt: Date;
  updatedAt: Date;
}

interface CreateInput {
  firmId: string;
  createdByUserId: string;
  name: string;
  visibility: TemplateVisibility;
  pages: TemplateDescriptor[];
}

interface UpdateInput {
  name?: string;
  visibility?: TemplateVisibility;
  pages?: TemplateDescriptor[];
}

function toRow(r: typeof presentationTemplates.$inferSelect): TemplateRow {
  return {
    id: r.id,
    firmId: r.firmId,
    createdByUserId: r.createdByUserId,
    visibility: r.visibility as TemplateVisibility,
    name: r.name,
    pages: r.pages as TemplateDescriptor[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listTemplatesForUser(
  firmId: string,
  userId: string,
): Promise<{ shared: TemplateRow[]; mine: TemplateRow[] }> {
  const rows = await db
    .select()
    .from(presentationTemplates)
    .where(eq(presentationTemplates.firmId, firmId))
    .orderBy(asc(presentationTemplates.name));
  const shared: TemplateRow[] = [];
  const mine: TemplateRow[] = [];
  for (const r of rows) {
    const row = toRow(r);
    if (row.visibility === "shared") shared.push(row);
    else if (row.createdByUserId === userId) mine.push(row);
  }
  return { shared, mine };
}

export async function getTemplateById(id: string, firmId: string): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(presentationTemplates)
    .where(and(eq(presentationTemplates.id, id), eq(presentationTemplates.firmId, firmId)));
  return row ? toRow(row) : null;
}

export async function createTemplate(input: CreateInput): Promise<TemplateRow> {
  const [row] = await db
    .insert(presentationTemplates)
    .values({
      firmId: input.firmId,
      createdByUserId: input.createdByUserId,
      visibility: input.visibility,
      name: input.name,
      pages: input.pages,
    })
    .returning();
  return toRow(row);
}

export async function updateTemplate(
  id: string,
  firmId: string,
  patch: UpdateInput,
): Promise<TemplateRow | null> {
  const setObj: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) setObj.name = patch.name;
  if (patch.visibility !== undefined) setObj.visibility = patch.visibility;
  if (patch.pages !== undefined) setObj.pages = patch.pages;
  const [row] = await db
    .update(presentationTemplates)
    .set(setObj)
    .where(and(eq(presentationTemplates.id, id), eq(presentationTemplates.firmId, firmId)))
    .returning();
  return row ? toRow(row) : null;
}

export async function deleteTemplate(id: string, firmId: string): Promise<void> {
  await db
    .delete(presentationTemplates)
    .where(and(eq(presentationTemplates.id, id), eq(presentationTemplates.firmId, firmId)));
}
