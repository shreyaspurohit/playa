// Native gzip decompression via the browser's Compression Streams API.
// No JS dependency — `DecompressionStream` ships in:
//   Chrome / Edge: v80   (Feb 2020)
//   Firefox:       v113  (May 2023)
//   Safari + iOS:  v16.4 (March 2023)
// Effectively any browser updated in the last ~2.5 years. Below this
// floor we render the upgrade banner instead of attempting to decode.
//
// See ADR D12 (`docs/15-data-sources.md`).

/** Feature-detect: did this browser ship `DecompressionStream`? */
export function isGzipDecompressSupported(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

/**
 * Decompress a gzip blob to its plaintext bytes.
 *
 * Uses the platform's Compression Streams API directly — no JS gunzip
 * fallback bundled. Caller should `isGzipDecompressSupported()` before
 * touching any encrypted payload, and surface the upgrade banner when
 * unsupported.
 */
export async function decompressGzip(input: Uint8Array): Promise<Uint8Array> {
  // Construct a Response over a single-chunk stream; let the platform
  // decompress as it consumes the bytes. Cleaner than chunked manual
  // reader handling and identically fast in practice.
  const stream = new Blob([input as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
