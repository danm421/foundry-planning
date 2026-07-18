"use client";

import { useEffect, useRef, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

export type FamilyMemberFormInitial = {
  memberId?: string; // planning family_members.id (linked mode)
  contactId?: string; // linked/unlinked contact row id, if one exists
  firstName: string;
  lastName: string;
  relationship: string | null; // enum value; null for unlinked rows
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
};

export const RELATIONSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "stepchild", label: "Stepchild" },
  { value: "grandchild", label: "Grandchild" },
  { value: "great_grandchild", label: "Great-grandchild" },
  { value: "parent", label: "Parent" },
  { value: "grandparent", label: "Grandparent" },
  { value: "sibling", label: "Sibling" },
  { value: "sibling_in_law", label: "Sibling-in-law" },
  { value: "child_in_law", label: "Child-in-law" },
  { value: "niece_nephew", label: "Niece/Nephew" },
  { value: "aunt_uncle", label: "Aunt/Uncle" },
  { value: "cousin", label: "Cousin" },
  { value: "grand_aunt_uncle", label: "Grand-aunt/uncle" },
  { value: "other", label: "Other" },
];

const FORM_ID = "crm-family-member-form";

// Small fetch wrappers: throw the server's `error` string on !ok, otherwise
// return the parsed JSON body (used for the family-member row's `id`).
async function request(method: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(
      typeof j.error === "string" ? j.error : `Save failed (${res.status})`,
    );
  }
  return res.json().catch(() => ({}));
}
const post = (url: string, body: unknown) => request("POST", url, body);
const put = (url: string, body: unknown) => request("PUT", url, body);
const patch = (url: string, body: unknown) => request("PATCH", url, body);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  planningClientId: string | null;
  mode: "create" | "edit";
  initialValues?: FamilyMemberFormInitial;
  onSaved: () => void;
}

export function CrmFamilyMemberForm({
  open,
  onOpenChange,
  householdId,
  planningClientId,
  mode,
  initialValues,
  onSaved,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist the planning family-member id created during THIS open dialog. In
  // the linked-create path the POST /family-members can succeed and the
  // subsequent contact write throw — the dialog stays open. Without this, a
  // retry would POST /family-members again (duplicate member, orphaned first).
  // Reset on close so a fresh open (or reuse for a different member) starts
  // clean. See onSubmit's "existingMemberId → PUT else POST" branch.
  const createdMemberIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) createdMemberIdRef.current = null;
  }, [open]);

  // Prospect households (no planning client) have no family_members list to
  // drift from, so every save writes a CRM contact row — and
  // createCrmContactSchema.lastName is min(1). Last name is therefore always
  // required here; the linked flow keeps it optional (guarded in onSubmit).
  const isProspect = planningClientId === null;

  // Unlinked rows have nowhere to store a planning relationship, so hide the
  // select (and store contact info only) when there's no planning client and
  // no existing member to update.
  const showRelationship = planningClientId !== null || !!initialValues?.memberId;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);

    const get = (key: string) => {
      const v = String(data.get(key) ?? "").trim();
      return v ? v : undefined;
    };

    const firstName = String(data.get("firstName") ?? "").trim();
    const lastName = String(data.get("lastName") ?? "").trim();
    const relationship = get("relationship");
    const dateOfBirth = get("dateOfBirth");
    const email = get("email");
    const phone = get("phone");
    const mobile = get("mobile");
    const notes = get("notes");
    const hasContactInfo = !!(email || phone || mobile || notes);

    try {
      if (planningClientId) {
        // Finding 1: the family_members row allows a blank last name, but any
        // contact write here needs one (createCrmContactSchema.lastName is
        // min(1) — both the lazy-link POST and the PATCH always carry
        // `lastName`). Fail fast before any network call so we never surface a
        // raw 400, and never POST the member and THEN fail the contact write
        // (which is Finding 2's duplicate trigger).
        const willWriteContact = !!initialValues?.contactId || hasContactInfo;
        if (willWriteContact && !lastName) {
          throw new Error("Last name is required when saving contact info.");
        }

        const identity = { firstName, lastName, relationship, dateOfBirth };
        // Finding 2: branch on "have a member id from props OR the ref". After a
        // partial failure the created id lives in the ref, so a retry PUTs the
        // existing row (persisting any edits made between attempts) instead of
        // POSTing a duplicate.
        const existingMemberId = initialValues?.memberId ?? createdMemberIdRef.current;
        let memberId: string | undefined;
        if (existingMemberId) {
          await put(
            `/api/clients/${planningClientId}/family-members/${existingMemberId}`,
            identity,
          );
          memberId = existingMemberId;
        } else {
          const member = await post(
            `/api/clients/${planningClientId}/family-members`,
            identity,
          );
          memberId = member.id;
          createdMemberIdRef.current = memberId ?? null;
        }
        const contactFields = { email, phone, mobile, notes, firstName, lastName };
        if (initialValues?.contactId) {
          await patch(
            `/api/crm/households/${householdId}/contacts/${initialValues.contactId}`,
            contactFields,
          );
        } else if (hasContactInfo) {
          // Lazy link — createCrmContact upserts on familyMemberId, so a
          // concurrent double-submit degrades to an update, not an error.
          await post(`/api/crm/households/${householdId}/contacts`, {
            role: "dependent",
            familyMemberId: memberId,
            ...contactFields,
          });
        }
      } else {
        // Prospect household — plain CRM-only dependent row (no planning list
        // to drift from).
        const body = {
          role: "dependent",
          firstName,
          lastName,
          dateOfBirth,
          email,
          phone,
          mobile,
          notes,
        };
        if (initialValues?.contactId) {
          await patch(
            `/api/crm/households/${householdId}/contacts/${initialValues.contactId}`,
            body,
          );
        } else {
          await post(`/api/crm/households/${householdId}/contacts`, body);
        }
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Edit family member" : "Add family member"}
      size="md"
      primaryAction={{
        label: submitting
          ? "Saving…"
          : mode === "edit"
            ? "Save changes"
            : "Add family member",
        form: FORM_ID,
        loading: submitting,
      }}
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {showRelationship ? (
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-relationship">
              Relationship
            </label>
            <select
              id="fm-relationship"
              name="relationship"
              defaultValue={initialValues?.relationship ?? "child"}
              className={selectClassName}
            >
              {RELATIONSHIP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            Not linked to planning — contact info only
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-first">
              First name <span className="text-crit">*</span>
            </label>
            <input
              id="fm-first"
              name="firstName"
              required
              maxLength={100}
              defaultValue={initialValues?.firstName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-last">
              Last name {isProspect && <span className="text-crit">*</span>}
            </label>
            <input
              id="fm-last"
              name="lastName"
              required={isProspect}
              maxLength={100}
              defaultValue={initialValues?.lastName ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-dob">
              Date of birth
            </label>
            <input
              id="fm-dob"
              name="dateOfBirth"
              type="date"
              defaultValue={initialValues?.dateOfBirth ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-email">
              Email
            </label>
            <input
              id="fm-email"
              name="email"
              type="email"
              defaultValue={initialValues?.email ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-phone">
              Phone
            </label>
            <input
              id="fm-phone"
              name="phone"
              maxLength={40}
              defaultValue={initialValues?.phone ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="fm-mobile">
              Mobile
            </label>
            <input
              id="fm-mobile"
              name="mobile"
              maxLength={40}
              defaultValue={initialValues?.mobile ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="fm-notes">
            Notes (CRM)
          </label>
          <textarea
            id="fm-notes"
            name="notes"
            rows={3}
            maxLength={5000}
            defaultValue={initialValues?.notes ?? ""}
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
