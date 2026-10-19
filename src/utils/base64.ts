/**
 * Base64 encoding for binary payloads sent to the native side.
 *
 * Binary data crosses the Tauri IPC boundary as a base64 string. That costs a
 * third of the payload size but keeps the transport to plain JSON, which is
 * predictable across platforms and easy to validate on the Rust side. The
 * encoder is hand-written instead of using `btoa` because `btoa` needs a
 * binary string (which blows up on multi-megabyte inputs and would require a
 * second pass) and because this module must also work under Node in tests.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAD = "=";
/** Number of input bytes encoded per internal chunk (a multiple of 3). */
const CHUNK_BYTES = 3 * 1024;

const DECODE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < ALPHABET.length; index += 1) {
    table[ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/**
 * Encodes bytes as standard base64 with padding.
 *
 * The input is processed in chunks whose size is a multiple of three, so only
 * the final chunk can ever produce padding and the output is identical to
 * encoding the whole buffer at once.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, bytes.length);
    let out = "";
    let index = offset;

    for (; index + 2 < end; index += 3) {
      const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
      out +=
        ALPHABET[(value >> 18) & 63] +
        ALPHABET[(value >> 12) & 63] +
        ALPHABET[(value >> 6) & 63] +
        ALPHABET[value & 63];
    }

    const remaining = end - index;
    if (remaining === 1) {
      const value = bytes[index];
      out += ALPHABET[value >> 2] + ALPHABET[(value & 3) << 4] + PAD + PAD;
    } else if (remaining === 2) {
      const value = (bytes[index] << 8) | bytes[index + 1];
      out +=
        ALPHABET[value >> 10] + ALPHABET[(value >> 4) & 63] + ALPHABET[(value & 15) << 2] + PAD;
    }

    parts.push(out);
  }

  return parts.join("");
}

/**
 * Decodes standard base64 with padding (`=`), or returns `null` when the text
 * is not valid base64.
 *
 * Used by the project parser to reject a fill patch before any pixels are
 * allocated: the caller checks the decoded length against the patch's declared
 * bounding box.
 */
export function base64ToBytes(text: string): Uint8Array | null {
  const trimmed = text.replace(/\s+/g, "");
  if (trimmed.length === 0) {
    return new Uint8Array(0);
  }
  if (trimmed.length % 4 !== 0) {
    return null;
  }

  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  const body = padding > 0 ? trimmed.slice(0, trimmed.length - padding) : trimmed;
  if (body.includes("=")) {
    return null;
  }
  const bytes = new Uint8Array((trimmed.length / 4) * 3 - padding);
  let output = 0;

  for (let offset = 0; offset < trimmed.length; offset += 4) {
    const lastGroup = offset === trimmed.length - 4;
    const a = decodeChar(trimmed.charCodeAt(offset));
    const b = decodeChar(trimmed.charCodeAt(offset + 1));
    const c = decodeChar(trimmed.charCodeAt(offset + 2), lastGroup);
    const d = decodeChar(trimmed.charCodeAt(offset + 3), lastGroup);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      return null;
    }

    const value = (a << 18) | (b << 12) | (c << 6) | d;
    if (output < bytes.length) {
      bytes[output] = (value >> 16) & 0xff;
      output += 1;
    }
    if (output < bytes.length) {
      bytes[output] = (value >> 8) & 0xff;
      output += 1;
    }
    if (output < bytes.length) {
      bytes[output] = value & 0xff;
      output += 1;
    }
  }

  return bytes;
}

function decodeChar(code: number, allowPadding = false): number {
  // `=` is only meaningful at the end of the final group, where it contributes
  // zero bits; anywhere else it is a malformed payload.
  if (code === 61) {
    return allowPadding ? 0 : -1;
  }
  return code < DECODE.length ? DECODE[code] : -1;
}
