// Integrity pin verification for downloaded model assets (ADR 21 D6).
//
// Pure + no heavy imports so it is unit-testable and can be shared without
// pulling in the web-llm chunk. Uses Web Crypto (available in browsers and in
// Node's webcrypto), so tests run without a real WebGPU/model runtime.

/** Lowercase-hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True iff the bytes hash to the pinned (case-insensitive) hex digest. */
export async function matchesSha256(bytes: ArrayBuffer, expectedHex: string): Promise<boolean> {
  return (await sha256Hex(bytes)) === expectedHex.toLowerCase();
}
