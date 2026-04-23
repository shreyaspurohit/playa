// Highlight returns Preact VNodes; we don't need a DOM to test the
// output shape — just walk the returned array.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/utils/highlight';

describe('highlight', () => {
  test('returns the raw text when the query is empty', () => {
    const out = highlight('hello world', '');
    assert.deepEqual(out, ['hello world']);
  });

  test('wraps each case-insensitive match in a <mark>', () => {
    const out = highlight('Cat and Caterpillar', 'cat');
    // Expect: [<mark>Cat</mark>, ' and ', <mark>Cat</mark>, 'erpillar']
    assert.equal(out.length, 4);
    // VNode #0 and #2 are <mark>
    assert.equal((out[0] as { type: string }).type, 'mark');
    assert.equal((out[2] as { type: string }).type, 'mark');
    assert.equal(out[1], ' and ');
    assert.equal(out[3], 'erpillar');
  });

  test('escapes regex metacharacters so a query like "foo.bar" is literal', () => {
    // "foo.bar" should only match the literal dotted string, not "fooXbar".
    const out = highlight('see fooXbar here, and foo.bar too', 'foo.bar');
    // The only <mark> should wrap "foo.bar", not "fooXbar".
    const marks = out.filter(
      (x) => typeof x !== 'string' && (x as { type: string }).type === 'mark',
    );
    assert.equal(marks.length, 1);
    // Preact's `h('mark', null, child)` stores the child as a string when
    // it's a single text node (not wrapped in an array). Normalize.
    const rawChildren = (marks[0] as { props: { children: unknown } }).props.children;
    const marked = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
    assert.deepEqual(marked, ['foo.bar']);
  });

  test('preserves empty text', () => {
    const out = highlight('', 'anything');
    assert.deepEqual(out, ['']);
  });
});
