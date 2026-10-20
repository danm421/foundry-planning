"use client";

import { useEffect } from "react";

/**
 * Password managers guess which fields are logins from a form's shape, so they
 * badge and offer to fill Foundry's dollar, age and name fields. Nothing here
 * outside Clerk's sign-in and account screens is a credential, so this marks
 * every other field with each vendor's opt-out as it mounts. The marks must be
 * on before the first click: 1Password reads them on first focus and caches.
 */
const IGNORE_ATTRIBUTES: [string, string][] = [
  ["data-1p-ignore", ""], // 1Password
  ["data-lpignore", "true"], // LastPass
  ["data-bwignore", ""], // Bitwarden
  ["data-form-type", "other"], // Dashlane
  ["data-protonpass-ignore", "true"], // Proton Pass
];

const FIELDS = 'input:not([type="hidden"]), textarea';

// A field that declares itself a credential keeps its password manager.
const CREDENTIAL_AUTOCOMPLETE = /\b(username|current-password|new-password|one-time-code|webauthn)\b/;

function isCredentialField(field: Element): boolean {
  return (
    CREDENTIAL_AUTOCOMPLETE.test(field.getAttribute("autocomplete") ?? "") ||
    // Clerk's own inputs (sign-in, account, team screens) all carry `cl-*` classes.
    Array.from(field.classList).some((c) => c.startsWith("cl-"))
  );
}

function markField(field: Element) {
  if (field.hasAttribute("data-1p-ignore") || isCredentialField(field)) return;
  for (const [name, value] of IGNORE_ATTRIBUTES) field.setAttribute(name, value);
  // Chrome's and Safari's built-in managers skip the vendor marks; this is the hint they read.
  if (!field.hasAttribute("autocomplete")) field.setAttribute("autocomplete", "off");
}

function markFieldsIn(node: Node) {
  if (!(node instanceof Element)) return;
  if (node.matches(FIELDS)) markField(node);
  node.querySelectorAll(FIELDS).forEach(markField);
}

export function PasswordManagerGuard() {
  useEffect(() => {
    markFieldsIn(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach(markFieldsIn);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
