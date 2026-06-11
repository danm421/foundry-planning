import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { checkFeedbackRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import {
  feedbackSubmissionSchema,
  validateScreenshots,
} from "@/lib/feedback/schema";
import { sendFeedbackEmail } from "@/lib/feedback/email";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const firmId = await requireOrgId();

    const rl = await checkFeedbackRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many submissions. Try again shortly.");
    }

    const fd = await req.formData();
    const parsed = feedbackSubmissionSchema.safeParse({
      mode: fd.get("mode"),
      subject: fd.get("subject") ?? undefined,
      type: fd.get("type") ?? undefined,
      message: fd.get("message"),
      pageUrl: fd.get("pageUrl") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid submission" },
        { status: 400 },
      );
    }

    const files = fd.getAll("screenshots").filter((v): v is File => v instanceof File);
    const screenshotCheck = validateScreenshots(files);
    if (!screenshotCheck.ok) {
      return NextResponse.json({ error: screenshotCheck.error }, { status: 422 });
    }

    const cc = await clerkClient();
    const user = await cc.users.getUser(userId);
    const advisorEmail =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
        ?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      "unknown@unknown";
    const advisorName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || advisorEmail;

    const attachments = await Promise.all(
      files.map(async (f) => ({
        filename: f.name,
        content: Buffer.from(await f.arrayBuffer()),
      })),
    );

    await sendFeedbackEmail({
      submission: parsed.data,
      context: {
        firmId,
        advisorName,
        advisorEmail,
        userAgent: req.headers.get("user-agent") ?? "unknown",
        submittedAt: new Date().toISOString(),
      },
      attachments,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/feedback] failed:", err);
    return NextResponse.json({ error: "Couldn't send your message." }, { status: 500 });
  }
}
