// Reads the embedded data out of the page. Either a plaintext JSON array
// of camps, or an encrypted envelope that the Gate component unlocks.
import type { Camp, EncryptedPayload } from './types';

export type Payload =
  | { kind: 'plain'; camps: Camp[] }
  | { kind: 'encrypted'; enc: EncryptedPayload };

export function readEmbeddedPayload(): Payload {
  const plain = document.getElementById('camps-data');
  if (plain) {
    const text = plain.textContent ?? '[]';
    return { kind: 'plain', camps: JSON.parse(text) as Camp[] };
  }
  const encEl = document.getElementById('camps-data-encrypted');
  if (encEl) {
    const text = encEl.textContent ?? '{}';
    return { kind: 'encrypted', enc: JSON.parse(text) as EncryptedPayload };
  }
  throw new Error('No camps data script in page');
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
