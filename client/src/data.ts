// Reads the embedded data out of the page. Either a plaintext JSON array
// of camps, or an encrypted envelope that the Gate component unlocks.
//
// Multi-source: each embedded source has its own <script> tag with id
// `camps-data-<source>` (plain) or `camps-data-<source>-encrypted`.
// The legacy ids `camps-data` / `camps-data-encrypted` (no source
// suffix) are also accepted as a fallback so an older bundle running
// against a newer page — or vice-versa during the migration window —
// still finds its data.
import type { Camp, EncryptedPayload, Source } from './types';

export type Payload =
  | { kind: 'plain'; camps: Camp[] }
  | { kind: 'encrypted'; enc: EncryptedPayload };

export function readEmbeddedPayload(source: Source = 'directory'): Payload {
  // Per-source ids first.
  const plain = document.getElementById(`camps-data-${source}`);
  if (plain) {
    const text = plain.textContent ?? '[]';
    return { kind: 'plain', camps: JSON.parse(text) as Camp[] };
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
    const text = legacyPlain.textContent ?? '[]';
    return { kind: 'plain', camps: JSON.parse(text) as Camp[] };
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
