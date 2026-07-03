import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  crmHouseholds,
  crmTaskActivity,
  crmTaskCommentMentions,
  crmTaskComments,
  crmTasks,
} from "@/db/schema";
import { postComment } from "../mutations";

const FIRM = "org_comment_mentions_test";
let taskId: string;

async function cleanup() {
  const tasks = await db.query.crmTasks.findMany({
    where: eq(crmTasks.firmId, FIRM),
    columns: { id: true },
  });
  for (const t of tasks) {
    await db.delete(crmTaskCommentMentions).where(eq(crmTaskCommentMentions.taskId, t.id));
    await db.delete(crmTaskComments).where(eq(crmTaskComments.taskId, t.id));
    await db.delete(crmTaskActivity).where(eq(crmTaskActivity.taskId, t.id));
  }
  await db.delete(crmTasks).where(eq(crmTasks.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
  await db.delete(auditLog).where(eq(auditLog.firmId, FIRM));
}

beforeEach(async () => {
  await cleanup();
  const [t] = await db
    .insert(crmTasks)
    .values({ firmId: FIRM, title: "T", createdByUserId: "u_author" })
    .returning();
  taskId = t.id;
});

describe("postComment mentions", () => {
  it("writes one deduped row per mentioned user, stamped with firm + task", async () => {
    const comment = await postComment(taskId, FIRM, "u_author", "hi @[A](user:u_1) @[B](user:u_2)", [
      "u_1",
      "u_2",
      "u_1",
    ]);
    const rows = await db.query.crmTaskCommentMentions.findMany({
      where: eq(crmTaskCommentMentions.commentId, comment.id),
    });
    expect(rows.map((r) => r.mentionedUserId).sort()).toEqual(["u_1", "u_2"]);
    for (const r of rows) {
      expect(r).toMatchObject({ taskId, firmId: FIRM, commentId: comment.id });
    }
  });

  it("writes no rows when there are no mentions (default param)", async () => {
    const comment = await postComment(taskId, FIRM, "u_author", "plain comment");
    const rows = await db.query.crmTaskCommentMentions.findMany({
      where: eq(crmTaskCommentMentions.commentId, comment.id),
    });
    expect(rows).toEqual([]);
  });

  it("cascades away when the comment is deleted", async () => {
    const comment = await postComment(taskId, FIRM, "u_author", "x", ["u_1"]);
    await db.delete(crmTaskComments).where(eq(crmTaskComments.id, comment.id));
    const rows = await db.query.crmTaskCommentMentions.findMany({
      where: eq(crmTaskCommentMentions.commentId, comment.id),
    });
    expect(rows).toEqual([]);
  });
});
