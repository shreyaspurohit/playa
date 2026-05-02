// Reads the embedded data out of the page. Either a plaintext list of
// camps (gzip + base64 inside `<script type="application/x-gzip-base64">`,
// per ADR D12) or an encrypted envelope that the Gate component unlocks.
//
// Multi-source: each embedded source has its own <script> tag with id
// `camps-data-<source>` (plain) or `camps-data-<source>-encrypted`.
// The legacy ids `camps-data` / `camps-data-encrypted` (no source
// suffix) are also accepted as a fallback so an older bundle running
// against a newer page — or vice-versa during the migration window —
// still finds its data. The legacy plain path also accepts raw JSON
// content (pre-D12 builds) when the script's `type` is
// `application/json` rather than the new gzip+base64 type.
import type {
  Camp, EncryptedPayload, Source, SourceCipher,
} from './types';
import { decompressGzip } from './utils/gzip';

/** Per-source bits in an envelope-mode build (ADR D10). The cipher is
 *  decrypted only after one of the wrappers unwraps successfully with
 *  the user's tier password. */
export interface EnvelopeSource {
  source: Source;
  cipher: SourceCipher;
  /** Wrapper envelopes in declaration order, indexed parallel to the
   *  manifest meta tag's content. Each is a normal PBKDF2+AES-CBC
   *  envelope wrapping the 48-byte DEK+IV blob. */
  wrappers: EncryptedPayload[];
  /** Parallel-indexed flags: `trusted[i]` is true when wrapper `i` was
   *  emitted for the `god-mode` tier (per `bm-trusted-wrappers`).
   *  When the user's password unwraps a trusted wrapper, the client
   *  applies per-tier privileges (e.g., bypassing the pre-burn
   *  location embargo) without ever knowing the tier's name. Empty
   *  array when the source has no trusted wrappers, or when the
   *  build didn't emit a trusted manifest at all. */
  trusted: boolean[];
}

export type Payload =
  | { kind: 'plain'; camps: Camp[] }
  | { kind: 'encrypted'; enc: EncryptedPayload }
  | { kind: 'envelope'; sources: EnvelopeSource[] };

const GZIP_B64_TYPE = 'application/x-gzip-base64';

/** base64 string → bytes. Modern browsers + Node both have `atob`. */
function base64ToBytes(s: string): Uint8Array {
  // Base64 padding on the embedded text is preserved by the build,
  // but be defensive in case anything trims it.
  const trimmed = s.trim();
  const padded = trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function readPlain(el: HTMLElement): Promise<Camp[]> {
  const type = el.getAttribute('type') ?? 'application/json';
  const text = el.textContent ?? '';
  if (type === GZIP_B64_TYPE) {
    // gzip + base64 → JSON.
    const inflated = await decompressGzip(base64ToBytes(text));
    return JSON.parse(new TextDecoder().decode(inflated)) as Camp[];
  }
  // Legacy raw-JSON path (pre-D12 plaintext builds, or a cached SW
  // serving an older shape).
  return JSON.parse(text || '[]') as Camp[];
}

/** Parse a `<meta name="<name>">` manifest if present.
 *
 *  Format: `<source>:<idx>,<idx>,…;<source>:<idx>,…`
 *  e.g.    `directory:0;api-2025:0,1;api-2026:0,1,2`
 *
 *  Returns null when the meta is absent or empty. Each map entry's
 *  value is the list of wrapper indices for that source. Used for
 *  both `bm-tier-wrappers` (every wrapper) and `bm-trusted-wrappers`
 *  (god-mode wrappers only). */
function readWrapperManifest(name: string): Map<Source, number[]> | null {
  if (typeof document === 'undefined') return null;
  const m = document.querySelector(`meta[name="${name}"]`);
  const raw = (m?.getAttribute('content') ?? '').trim();
  if (!raw) return null;
  const out = new Map<Source, number[]>();
  for (const seg of raw.split(';')) {
    const piece = seg.trim();
    if (!piece) continue;
    const colon = piece.indexOf(':');
    if (colon < 0) continue;
    const source = piece.slice(0, colon).trim();
    const idxs = piece.slice(colon + 1).split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (source && idxs.length > 0) out.set(source, idxs);
  }
  return out.size > 0 ? out : null;
}

/** Read the cipher + wrappers for one source out of the DOM.
 *
 *  `trustedIdxs` is the set of wrapper indices flagged trusted by the
 *  build's `bm-trusted-wrappers` manifest. The returned `trusted[]`
 *  array is parallel-indexed with `wrappers[]`, so a successful
 *  unwrap at position `i` reveals whether the wrapping tier was
 *  god-mode without us ever naming it. */
function readEnvelopeSource(
  source: Source, idxs: number[], trustedIdxs: Set<number>,
): EnvelopeSource | null {
  const cipherEl = document.getElementById(`camps-data-${source}-cipher`);
  if (!cipherEl) return null;
  const cipher = JSON.parse(cipherEl.textContent ?? '{}') as SourceCipher;
  const wrappers: EncryptedPayload[] = [];
  const trusted: boolean[] = [];
  for (const idx of idxs) {
    const el = document.getElementById(`cdk-${source}-${idx}`);
    if (!el) continue;
    wrappers.push(JSON.parse(el.textContent ?? '{}') as EncryptedPayload);
    trusted.push(trustedIdxs.has(idx));
  }
  return { source, cipher, wrappers, trusted };
}

export async function readEmbeddedPayload(
  source: Source = 'directory',
): Promise<Payload> {
  // Envelope mode (D10) overrides everything — the source-specific
  // cipher/wrapper scripts are the only camp data on the page.
  const manifest = readWrapperManifest('bm-tier-wrappers');
  if (manifest) {
    const trustedManifest = readWrapperManifest('bm-trusted-wrappers');
    const sources: EnvelopeSource[] = [];
    for (const [src, idxs] of manifest) {
      const trustedIdxs = new Set(trustedManifest?.get(src) ?? []);
      const env = readEnvelopeSource(src, idxs, trustedIdxs);
      if (env) sources.push(env);
    }
    if (sources.length === 0) {
      throw new Error('envelope manifest present but no sources resolved');
    }
    return { kind: 'envelope', sources };
  }

  // Per-source ids first.
  const plain = document.getElementById(`camps-data-${source}`);
  if (plain) {
    return { kind: 'plain', camps: await readPlain(plain) };
  }
  const enc = document.getElementById(`camps-data-${source}-encrypted`);
  if (enc) {
    const text = enc.textContent ?? '{}';
    return { kind: 'encrypted', enc: JSON.parse(text) as EncryptedPayload };
  }
  // Legacy fallback — pre-multi-source builds embedded `camps-data`
  // / `camps-data-encrypted` without any source suffix.
  const legacyPlain = document.getElementById('camps-data');
  if (legacyPlain) {
    return { kind: 'plain', camps: await readPlain(legacyPlain) };
  }
  const legacyEnc = document.getElementById('camps-data-encrypted');
  if (legacyEnc) {
    const text = legacyEnc.textContent ?? '{}';
    return { kind: 'encrypted', enc: JSON.parse(text) as EncryptedPayload };
  }
  throw new Error(`No camps data script for source "${source}"`);
}

// Pre-compute lowercase haystack per camp for fast substring search.
// Mutates each camp with a non-enumerable `_hay` for consumer use.
export function indexHaystacks(camps: Camp[]): void {
  for (const c of camps) {
    const parts: string[] = [
      c.name, c.location, c.description, c.website || '', c.tags.join(' '),
    ];
    for (const e of c.events || []) {
      parts.push(e.name, e.description, e.time, e.display_time);
    }
    Object.defineProperty(c, '_hay', {
      value: parts.join(' ␟ ').toLowerCase(),
      enumerable: false,
      writable: false,
    });
  }
}

export function haystackOf(camp: Camp): string {
  return (camp as Camp & { _hay?: string })._hay ?? '';
}
