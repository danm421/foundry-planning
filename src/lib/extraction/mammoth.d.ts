// Minimal ambient types for `mammoth`. The package ships no .d.ts and there
// is no @types/mammoth on the registry. We only consume extractRawText in the
// extraction pipeline; declare just that surface (convertToHtml is included
// for completeness in case a later HTML pass wants it).
declare module "mammoth" {
  interface MammothInput {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  interface MammothMessage {
    type: string;
    message: string;
  }

  interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export function extractRawText(input: MammothInput): Promise<MammothResult>;
  export function convertToHtml(input: MammothInput): Promise<MammothResult>;
}
