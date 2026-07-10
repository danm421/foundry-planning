"use client";
import { useRef } from "react";
import type { ReactElement } from "react";
import { portalBtn } from "@/components/portal/portal-card";
import { UploadIcon, SpinnerIcon } from "./vault-icons";

export function VaultUploadButton({
  busy,
  onFile,
}: {
  busy: boolean;
  onFile: (file: File) => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={portalBtn.primary}
      >
        {busy ? <SpinnerIcon width={15} height={15} /> : <UploadIcon width={15} height={15} />}
        {busy ? "Uploading…" : "Upload"}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset the input so selecting the SAME file again still fires
          // onChange (browsers suppress it otherwise).
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}
