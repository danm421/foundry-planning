import { createHash } from "node:crypto";

export async function sha256Hex(
  input: Buffer | ArrayBuffer | Uint8Array,
): Promise<string> {
  const buf = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : Buffer.from(input);
  return createHash("sha256").update(buf).digest("hex");
}
