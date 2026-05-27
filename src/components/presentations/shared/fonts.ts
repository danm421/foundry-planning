// Re-export Foundry's font registration so Presentations callers don't
// need to know the path. Idempotent.
export { ensureFontsRegistered } from "@/components/pdf/fonts";
