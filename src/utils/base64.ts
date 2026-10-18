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
