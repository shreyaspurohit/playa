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
import type { Camp, EncryptedPayload, Source } from './types';
import { decompressGzip } from './utils/gzip';

export type Payload =
  | { kind: 'plain'; camps: Camp[] }
  | { kind: 'encrypted'; enc: EncryptedPayload };

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

export async function readEmbeddedPayload(
  source: Source = 'directory',
): Promise<Payload> {
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
