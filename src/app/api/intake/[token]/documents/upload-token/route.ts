import { NextResponse } from "next/server";
import { z } from "zod";
import { gateIntakeDocumentRequest } from "@/lib/intake/document-gate";
import { MAX_INTAKE_FILE_BYTES } from "@/lib/crm/document-constants";
import { parseBody } from "@/lib/schemas/common";
import { issueStagedUpload, stagingPrefix } from "@/lib/uploads/staged-upload";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ filename: z.string().trim().min(1).max(255) });

/** Step 1 of every Data Collection upload (`@/lib/uploads/staged-upload`): a
 *  one-file Blob token under this form's own staging prefix, for the documents
 *  POST to file. Same gate as that POST — the token is the only credential. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gated = await gateIntakeDocumentRequest(token, req);
  if (gated.error) return gated.error;

  const parsed = await parseBody(BodySchema, req);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(
    await issueStagedUpload(
      stagingPrefix("intake", gated.form.id),
      parsed.data.filename,
      MAX_INTAKE_FILE_BYTES,
    ),
  );
}
