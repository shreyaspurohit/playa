// Return an array of text fragments and <mark> VNodes so Preact can
// render highlighted search matches inside arbitrary parents. The
// underlying pattern is case-insensitive and literal — we don't want
// user query strings to unexpectedly behave as regex.
import { h } from 'preact';
import type { VNode } from 'preact';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlight(text: string, query: string): (string | VNode)[] {
  if (!query || !text) return [text];
  const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(re);
  const out: (string | VNode)[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) out.push(h('mark', null, parts[i]));
    else if (parts[i]) out.push(parts[i]);
  }
  return out;
}
