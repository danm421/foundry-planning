"use client";

import type { ReactNode } from "react";
import { FieldTooltip } from "./field-tooltip";
import { fieldLabelBaseClassName } from "./input-styles";

/**
 * A field label with an optional `?` help badge beside it, spaced like
 * `fieldLabelClassName` so it lines up with plain labels in the same row. The
 * badge sits outside the <label> so its copy never joins the control's
 * accessible name.
 */
export function HelpLabel({
  htmlFor,
  help,
  helpSide,
  children,
}: {
  htmlFor?: string;
  help?: string;
  helpSide?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <label className={fieldLabelBaseClassName} htmlFor={htmlFor}>
        {children}
      </label>
      {help && <FieldTooltip text={help} side={helpSide} />}
    </div>
  );
}
