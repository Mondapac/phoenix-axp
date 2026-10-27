import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { list, safeHref, text } from './types.ts';

describe('block prop readers', () => {
  it('lets through same-site paths, fragments, https and mailto only', () => {
    assert.equal(safeHref('/forms/appointment'), '/forms/appointment');
    assert.equal(safeHref('#news'), '#news');
    assert.equal(safeHref('https://example.ir/a'), 'https://example.ir/a');
    assert.equal(safeHref('mailto:info@example.ir'), 'mailto:info@example.ir');
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'http://plain.example',
      '',
      42,
    ]) {
      assert.equal(safeHref(bad), null, String(bad));
    }
  });

  it('turns anything that is not a string or a list into an empty value', () => {
    assert.equal(text({ __html: '<b>x</b>' }), '');
    assert.deepEqual(
      list('nope', (item) => item),
      [],
    );
    assert.deepEqual(
      list([null, 3, { a: 1 }], (item) => item.a),
      [1],
    );
  });
});
