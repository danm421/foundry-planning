import type { ReactElement, ReactNode } from "react";
import {
  fieldLabelClassName,
  inputClassName,
} from "@/components/forms/input-styles";

/**
 * Labelled control for the portal's people dialogs, with a real `htmlFor`/`id`
 * pairing — a bare `<label>` with no `htmlFor` defeats `getByLabelText`, and
 * that is how these fields are driven in tests.
 *
 * Use `DialogField` when the control is not a text input (a `<select>`);
 * `DialogTextField` covers the common case.
 */
export function DialogField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClassName}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function DialogTextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  /** Marks the dialog's entry point. `DialogShell` focuses `[data-autofocus]`
   *  itself — React's own `autoFocus` loses the race with its focus effect. */
  autoFocus?: boolean;
}): ReactElement {
  return (
    <DialogField id={id} label={label}>
      <input
        id={id}
        type={type}
        value={value}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      />
    </DialogField>
  );
}
