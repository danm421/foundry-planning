import { intakeDocTypeLabel, type IntakeDocumentView } from "@/lib/intake/document-types";
import { formatBytes } from "@/components/portal/documents/vault-format";

const labelCls = "block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

/**
 * What the client attached. Filenames link to the EXISTING advisor vault route,
 * which is org-scoped by `requireVaultAccess`, audited as
 * `vault.document.download`, and serves the bytes as an attachment with
 * nosniff. There is deliberately no second download path for intake files.
 *
 * Lives in its own file rather than inside `review-detail` because uploads
 * happen while the form is still out with the client: the in-flight view wants
 * the same list, and it is a server component that must not pull the review
 * screen's client bundle in to get it.
 */
export function DocumentsSection({
  documents,
  householdId,
}: {
  documents: IntakeDocumentView[];
  householdId: string | null;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={labelCls}>Documents</h3>
        <span className="tabular text-[12px] text-ink-3">
          {documents.length} uploaded
        </span>
      </div>
      {documents.length === 0 ? (
        <p className="text-[13px] text-ink-4">No documents uploaded.</p>
      ) : (
        <ul className="space-y-1">
          {documents.map((doc) => {
            const type = intakeDocTypeLabel(doc.docType);
            return (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-4 py-1 text-[14px]"
              >
                <div className="min-w-0">
                  {householdId ? (
                    <a
                      href={`/api/crm/households/${householdId}/documents/${doc.id}`}
                      className="text-ink underline-offset-2 transition-colors hover:text-accent hover:underline"
                    >
                      {doc.filename}
                    </a>
                  ) : (
                    <span className="text-ink">{doc.filename}</span>
                  )}
                  {type && <span className="ml-2 text-[12px] text-ink-4">{type}</span>}
                </div>
                <span className="tabular shrink-0 text-[13px] text-ink-3">
                  {formatBytes(doc.sizeBytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
