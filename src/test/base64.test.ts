/**
 * Base64 encoder tests.
 *
 * The encoder is hand-written because `btoa` needs a binary string, so it is
 * checked against the canonical vectors and against `btoa` for an input that
 * spans the internal chunk boundary - the only place a hand-rolled encoder can
 * plausibly go wrong.
 */

import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../utils/base64";

const encoder = new TextEncoder();

function encodeText(text: string): string {
  return bytesToBase64(encoder.encode(text));
}

/** Reference encoder, including how `btoa` handles large inputs in chunks. */
function referenceBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("bytesToBase64", () => {
  it("matches the canonical vectors", () => {
    expect(encodeText("")).toBe("");
    expect(encodeText("f")).toBe("Zg==");
    expect(encodeText("fo")).toBe("Zm8=");
    expect(encodeText("foo")).toBe("Zm9v");
    expect(encodeText("foob")).toBe("Zm9vYg==");
    expect(encodeText("fooba")).toBe("Zm9vYmE=");
    expect(encodeText("foobar")).toBe("Zm9vYmFy");
  });

  it("encodes the PNG signature the way the Rust side expects to decode it", () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytesToBase64(signature)).toBe("iVBORw0KGgo=");
  });

  it("is correct across the internal chunk boundary", () => {
    // Comfortably more than one 3 KiB chunk, with a remainder of two bytes.
    const bytes = new Uint8Array(3 * 1024 * 4 + 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (index * 37 + 11) & 0xff;
    }

    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe(referenceBase64(bytes));
    expect(encoded.endsWith("=")).toBe(true);
    expect(encoded.length % 4).toBe(0);
  });
});
