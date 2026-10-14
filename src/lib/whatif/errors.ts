// src/lib/whatif/errors.ts
//
// The one error the what-if layer raises for a change it cannot apply. Its
// message is written for the model to read, fix and retry — the MCP route
// allowlists it, so it reaches Claude verbatim instead of the generic
// "could not complete that request".

export class WhatIfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatIfValidationError";
  }
}

/** `Change 3: …` — 1-based, matching the order the model wrote the list in. */
export function changeError(index: number, message: string): WhatIfValidationError {
  return new WhatIfValidationError(`Change ${index + 1}: ${message}`);
}
