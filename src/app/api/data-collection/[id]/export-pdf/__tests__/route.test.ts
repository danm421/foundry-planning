import { describe, it, expect, vi, beforeEach } from "vitest";

// Everything IO is mocked; the payload parse and the answers model run for real,
// so a payload the submit schema rejects really is rejected.

vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

const subscriptionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: subscriptionMock,
  authErrorResponse: (err: unknown) =>
    err instanceof Error && err.name === "ForbiddenError"
      ? { status: 403, body: { error: "Active subscription required" } }
      : null,
}));

const rateLimitMocks = vi.hoisted(() => ({
  checkExportPdfRateLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => rateLimitMocks);

const loadFormForFirmMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/intake/queries", () => ({ loadFormForFirm: loadFormForFirmMock }));

vi.mock("@/lib/intake/documents", () => ({ listIntakeDocuments: vi.fn().mockResolvedValue([]) }));

vi.mock("@/lib/branding/branding", () => ({
  resolveBranding: vi.fn().mockResolvedValue({
    firmName: "Ethos Financial Group",
    primaryColor: "#111111",
    logoDataUrl: null,
  }),
}));
vi.mock("@/lib/presentations/default-logo", () => ({
  foundryDefaultLogoDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
}));

const recordAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ recordAudit: recordAuditMock }));

// Mocked wholesale: the real component calls StyleSheet.create at module scope,
// which would throw against a renderer mock that only provides renderToBuffer.
vi.mock("@/components/intake-answers-pdf/intake-answers-pdf-document", () => ({
  IntakeAnswersPdfDocument: () => null,
}));
const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { POST } from "../route";
import { IntakeAnswersPdfDocument } from "@/components/intake-answers-pdf/intake-answers-pdf-document";

const post = () => POST(new Request("http://localhost/api/data-collection/form-1/export-pdf", { method: "POST" }), {
  params: Promise.resolve({ id: "form-1" }),
});

const submittedForm = (over: Record<string, unknown> = {}) => ({
  id: "form-1",
  firmId: "firm-1",
  clientId: "client-1",
  status: "applied",
  sections: ["family", "accounts"],
  recipientName: "Jane Doe",
  recipientEmail: "jane@example.com",
  sentAt: new Date("2026-09-28T15:00:00Z"),
  submittedAt: new Date("2026-10-03T15:00:00Z"),
  payload: {
    family: {
      primary: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1975-04-02" },
      children: [],
    },
    accounts: [{ name: "401(k)", category: "retirement", value: 450_000, owner: "client" }],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionMock.mockResolvedValue(undefined);
  rateLimitMocks.checkExportPdfRateLimit.mockResolvedValue({ allowed: true });
  renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  loadFormForFirmMock.mockResolvedValue(submittedForm());
});

describe("POST /api/data-collection/[id]/export-pdf", () => {
  it("returns the PDF as a named download and audits the export", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="data-collection-jane-doe-2026-10-03.pdf"',
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.4 fake");

    expect(loadFormForFirmMock).toHaveBeenCalledWith("form-1", "firm-1");
    expect(recordAuditMock).toHaveBeenCalledWith({
      action: "intake.form.export_pdf",
      resourceType: "intake_form",
      resourceId: "form-1",
      clientId: "client-1",
      firmId: "firm-1",
    });
  });

  it("hands the renderer the client's answers under the firm's branding", async () => {
    await post();
    const [element] = renderToBufferMock.mock.calls[0] as [
      {
        type: unknown;
        props: { doc: { householdName: string; sections: { key: string }[] }; firmName: string; logoDataUrl: string };
      },
    ];
    expect(element.type).toBe(IntakeAnswersPdfDocument);
    const { props } = element;
    expect(props.firmName).toBe("Ethos Financial Group");
    // No firm logo — the Foundry lockup stands in, as on the deck cover.
    expect(props.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(props.doc.householdName).toBe("Jane Doe");
    expect(props.doc.sections.map((s) => s.key)).toEqual(["family", "accounts"]);
  });

  it("works for a discarded form too — the answers still came back", async () => {
    loadFormForFirmMock.mockResolvedValue(submittedForm({ status: "discarded", clientId: null }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: null }));
  });

  it("404s a form outside the caller's firm", async () => {
    loadFormForFirmMock.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(404);
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it("409s a form the client has not submitted", async () => {
    loadFormForFirmMock.mockResolvedValue(submittedForm({ status: "draft", submittedAt: null, payload: {} }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This form hasn't been submitted yet." });
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it("422s a stored payload the submit schema cannot read", async () => {
    loadFormForFirmMock.mockResolvedValue(submittedForm({ payload: { family: { primary: {} } } }));
    const res = await post();
    expect(res.status).toBe(422);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before loading anything", async () => {
    rateLimitMocks.checkExportPdfRateLimit.mockResolvedValue({ allowed: false, reason: "limited" });
    rateLimitMocks.rateLimitErrorResponse.mockReturnValue(new Response(null, { status: 429 }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(loadFormForFirmMock).not.toHaveBeenCalled();
  });

  it("refuses a firm without an active subscription", async () => {
    const err = new Error("Active subscription required");
    err.name = "ForbiddenError";
    subscriptionMock.mockRejectedValue(err);
    const res = await post();
    expect(res.status).toBe(403);
    expect(loadFormForFirmMock).not.toHaveBeenCalled();
  });
});
