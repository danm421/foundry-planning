import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkFeedbackRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(() => new Response("limited", { status: 429 })),
}));
vi.mock("@/lib/feedback/email", () => ({ sendFeedbackEmail: vi.fn() }));

import { requireOrgId } from "@/lib/db-helpers";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { checkFeedbackRateLimit } from "@/lib/rate-limit";
import { sendFeedbackEmail } from "@/lib/feedback/email";
import { POST } from "../route";

const mockedRequireOrgId = vi.mocked(requireOrgId);
const mockedAuth = vi.mocked(auth);
const mockedClerk = vi.mocked(clerkClient);
const mockedSend = vi.mocked(sendFeedbackEmail);

function form(fields: Record<string, string>, files: File[] = []): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const f of files) fd.append("screenshots", f);
  return fd;
}
function req(fd: FormData): Request {
  return new Request("http://test/api/feedback", { method: "POST", body: fd });
}
function imageFile(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireOrgId.mockResolvedValue("org_1");
  mockedAuth.mockResolvedValue({ userId: "user_1" } as never);
  mockedClerk.mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        firstName: "Dana",
        lastName: "Advisor",
        primaryEmailAddressId: "idem_1",
        emailAddresses: [{ id: "idem_1", emailAddress: "dana@firm.com" }],
      }),
    },
  } as never);
});

describe("POST /api/feedback", () => {
  it("401s when signed out", async () => {
    mockedAuth.mockResolvedValue({ userId: null } as never);
    const res = await POST(req(form({ mode: "support", subject: "s", message: "m" })));
    expect(res.status).toBe(401);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("400s on an invalid submission", async () => {
    const res = await POST(req(form({ mode: "support", subject: "", message: "" })));
    expect(res.status).toBe(400);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("422s when a screenshot is the wrong type", async () => {
    const bad = new File([new Uint8Array(10)], "x.pdf", { type: "application/pdf" });
    const res = await POST(
      req(form({ mode: "feedback", type: "bug", message: "m" }, [bad])),
    );
    expect(res.status).toBe(422);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("429s when rate-limited", async () => {
    vi.mocked(checkFeedbackRateLimit).mockResolvedValueOnce({
      allowed: false,
      reason: "exceeded",
    } as never);
    const res = await POST(req(form({ mode: "support", subject: "s", message: "m" })));
    expect(res.status).toBe(429);
  });

  it("sends and returns 200 on a valid feedback submission with a screenshot", async () => {
    const res = await POST(
      req(
        form(
          { mode: "feedback", type: "bug", message: "blank chart", pageUrl: "http://app/x" },
          [imageFile("shot.png")],
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const arg = mockedSend.mock.calls[0][0];
    expect(arg.context.advisorEmail).toBe("dana@firm.com");
    expect(arg.context.advisorName).toBe("Dana Advisor");
    expect(arg.attachments).toHaveLength(1);
  });
});
